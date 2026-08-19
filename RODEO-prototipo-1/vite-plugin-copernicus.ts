import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import https from "node:https";
import tls from "node:tls";
import fs from "node:fs";
import path from "node:path";
import {
  COPERNICUS_CLIENT_ID,
  COPERNICUS_CLIENT_SECRET,
} from "./copernicus.credentials";

/**
 * Middleware de desarrollo que habla con Copernicus Data Space Ecosystem.
 *
 * Vive del lado de Node por dos motivos:
 *  1. El endpoint de token (Keycloak) no manda cabeceras CORS, así que una
 *     llamada directa desde el navegador falla siempre.
 *  2. El client_secret no tiene que viajar al browser.
 *
 * El front sólo ve `/api/copernicus/*`.
 */

const TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATISTICS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

const TIMEOUT_MS = 60_000;
const PLACEHOLDER = /^PEGA_ACA_/;

/* ------------------------------------------------------------------ */
/* TLS: cadena de CAs                                                  */
/* ------------------------------------------------------------------ */

/**
 * En redes corporativas con inspección TLS, el certificado que ve Node está
 * firmado por una CA interna. El navegador la acepta porque la lee del almacén
 * de Windows; Node no lo hace (y `--use-system-ca` recién existe desde v22.15).
 * Por eso sumamos a las CAs públicas cualquier .pem que haya en `certs/`.
 * Generá ese archivo con `npm run certs`.
 */
const DIR_CERTS = path.resolve(process.cwd(), "certs");

function separarCertificados(contenido: string): string[] {
  return (
    contenido.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) ?? []
  );
}

function construirCadenaCa(): { cadena: string[]; extras: number } {
  const cadena = [...tls.rootCertificates];
  let extras = 0;

  const fuentes: string[] = [];
  if (fs.existsSync(DIR_CERTS)) {
    for (const archivo of fs.readdirSync(DIR_CERTS)) {
      if (/\.(pem|crt|cer)$/i.test(archivo)) fuentes.push(path.join(DIR_CERTS, archivo));
    }
  }
  if (process.env.NODE_EXTRA_CA_CERTS) fuentes.push(process.env.NODE_EXTRA_CA_CERTS);

  for (const fuente of fuentes) {
    try {
      // Un .pem puede traer muchos certificados; Node necesita cada bloque suelto.
      const certificados = separarCertificados(fs.readFileSync(fuente, "utf8"));
      cadena.push(...certificados);
      extras += certificados.length;
    } catch {
      /* si un archivo no se puede leer, seguimos con el resto */
    }
  }

  return { cadena, extras };
}

const { cadena: CADENA_CA, extras: CA_EXTRAS } = construirCadenaCa();

const ERRORES_TLS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_SIGNATURE_FAILURE",
]);

/* ------------------------------------------------------------------ */
/* Cliente HTTP                                                        */
/* ------------------------------------------------------------------ */

class ErrorHttp extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

interface RespuestaHttp {
  status: number;
  texto: string;
}

/**
 * POST sobre `node:https` en vez de `fetch`, porque necesitamos pasarle una
 * cadena de CAs propia y el fetch global de Node no lo permite.
 */
function postear(
  url: string,
  cuerpo: string,
  cabeceras: Record<string, string>,
): Promise<RespuestaHttp> {
  return new Promise((resolve, reject) => {
    const destino = new URL(url);
    const req = https.request(
      {
        hostname: destino.hostname,
        port: destino.port || 443,
        path: destino.pathname + destino.search,
        method: "POST",
        ca: CADENA_CA,
        headers: {
          ...cabeceras,
          "Content-Length": Buffer.byteLength(cuerpo).toString(),
        },
      },
      (res) => {
        let datos = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          datos += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, texto: datos }));
      },
    );

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`La consulta a ${destino.hostname} superó los ${TIMEOUT_MS / 1000} s.`));
    });

    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code && ERRORES_TLS.has(error.code)) {
        reject(
          new ErrorHttp(
            502,
            `TLS rechazado al conectar con ${destino.hostname} (${error.code}). ` +
              "Tu red usa inspección TLS y Node no conoce la CA corporativa. " +
              "Corré `npm run certs` para exportarla y reiniciá el dev-server." +
              (CA_EXTRAS > 0
                ? ` (Ya se cargaron ${CA_EXTRAS} certificados extra desde certs/, pero no alcanzaron.)`
                : ""),
          ),
        );
        return;
      }
      reject(error);
    });

    req.write(cuerpo);
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/* Autenticación                                                       */
/* ------------------------------------------------------------------ */

function credencialesConfiguradas(): boolean {
  return (
    !!COPERNICUS_CLIENT_ID &&
    !!COPERNICUS_CLIENT_SECRET &&
    !PLACEHOLDER.test(COPERNICUS_CLIENT_ID) &&
    !PLACEHOLDER.test(COPERNICUS_CLIENT_SECRET)
  );
}

let tokenCache: { token: string; expiraEn: number } | null = null;

async function obtenerToken(forzarRenovacion = false): Promise<string> {
  if (!forzarRenovacion && tokenCache && Date.now() < tokenCache.expiraEn) {
    return tokenCache.token;
  }

  const { status, texto } = await postear(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: COPERNICUS_CLIENT_ID,
      client_secret: COPERNICUS_CLIENT_SECRET,
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
  );

  if (status !== 200) {
    tokenCache = null;
    throw new ErrorHttp(
      status === 401 ? 401 : 502,
      `Copernicus rechazó las credenciales (HTTP ${status}). Revisá client id y secret en copernicus.credentials.ts. Respuesta: ${texto.slice(0, 300)}`,
    );
  }

  const json = JSON.parse(texto) as { access_token: string; expires_in: number };
  // Renovamos un minuto antes del vencimiento real para no cortar una tanda.
  tokenCache = {
    token: json.access_token,
    expiraEn: Date.now() + (json.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

async function pedirEstadisticas(cuerpo: string): Promise<RespuestaHttp> {
  const llamar = (token: string) =>
    postear(STATISTICS_URL, cuerpo, {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });

  let respuesta = await llamar(await obtenerToken());
  // Si el token se venció antes de tiempo (o lo revocaron), reintentamos una vez.
  if (respuesta.status === 401) {
    respuesta = await llamar(await obtenerToken(true));
  }
  return respuesta;
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let datos = "";
    req.on("data", (chunk) => {
      datos += chunk;
    });
    req.on("end", () => resolve(datos));
    req.on("error", reject);
  });
}

function responderJson(res: ServerResponse, status: number, cuerpo: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(cuerpo));
}

async function manejarEstadisticas(
  req: IncomingMessage,
  res: ServerResponse,
  server: ViteDevServer,
): Promise<void> {
  try {
    if (!credencialesConfiguradas()) {
      throw new ErrorHttp(
        503,
        "Faltan las credenciales de Copernicus. Completá COPERNICUS_CLIENT_ID y COPERNICUS_CLIENT_SECRET en copernicus.credentials.ts y reiniciá el dev-server.",
      );
    }
    const { status, texto } = await pedirEstadisticas(await leerCuerpo(req));
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(texto);
  } catch (error) {
    const status = error instanceof ErrorHttp ? error.status : 500;
    const mensaje = error instanceof Error ? error.message : "Error desconocido";
    server.config.logger.error(`[copernicus] ${mensaje}`);
    responderJson(res, status, { error: mensaje });
  }
}

export default function copernicusPlugin(): Plugin {
  return {
    name: "rodeo-copernicus",
    configureServer(server) {
      if (CA_EXTRAS > 0) {
        server.config.logger.info(
          `[copernicus] ${CA_EXTRAS} certificados de CA extra cargados desde certs/`,
        );
      }

      server.middlewares.use("/api/copernicus", (req, res, next) => {
        const ruta = (req.url ?? "").split("?")[0];

        if (ruta === "/estado" && req.method === "GET") {
          responderJson(res, 200, { configurado: credencialesConfiguradas() });
          return;
        }

        if (ruta === "/statistics" && req.method === "POST") {
          void manejarEstadisticas(req, res, server);
          return;
        }

        next();
      });
    },
  };
}
