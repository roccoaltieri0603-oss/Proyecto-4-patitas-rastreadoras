import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../http/errors.js';

const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const STATISTICS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/statistics';
const TIMEOUT_MS = 60_000;
const RENOVAR_ANTES_MS = 60_000;
const PLACEHOLDER = /^PEGA_ACA_/;

export interface RespuestaCopernicus { status: number; texto: string; }
export interface TransporteCopernicus { (url: string, cuerpo: string, cabeceras: Record<string, string>): Promise<RespuestaCopernicus>; }
export interface CredencialesCopernicus { clientId: string; clientSecret: string; }

export class ErrorCopernicus extends Error {
  constructor(readonly status: number, message: string, readonly code = 'COPERNICUS_UPSTREAM_ERROR') { super(message); }
}

function credencialesDesdeEntorno(): CredencialesCopernicus {
  return { clientId: process.env.COPERNICUS_CLIENT_ID?.trim() ?? '', clientSecret: process.env.COPERNICUS_CLIENT_SECRET?.trim() ?? '' };
}

function separarCertificados(contenido: string): string[] {
  return contenido.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

function construirCadenaCa(): string[] {
  const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
  const candidatos = [path.resolve(process.cwd(), 'certs'), path.resolve(process.cwd(), '..', 'certs'), path.join(raizRepo, 'certs')];
  const fuentes = new Set<string>();
  for (const directorio of candidatos) {
    if (!fs.existsSync(directorio)) continue;
    for (const archivo of fs.readdirSync(directorio)) if (/\.(pem|crt|cer)$/i.test(archivo)) fuentes.add(path.join(directorio, archivo));
  }
  if (process.env.NODE_EXTRA_CA_CERTS) fuentes.add(process.env.NODE_EXTRA_CA_CERTS);
  const cadena = [...tls.rootCertificates];
  for (const fuente of fuentes) {
    try { cadena.push(...separarCertificados(fs.readFileSync(fuente, 'utf8'))); } catch { /* CA opcional ilegible */ }
  }
  return cadena;
}

const CADENA_CA = construirCadenaCa();
const ERRORES_TLS = new Set(['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_SIGNATURE_FAILURE']);

const transporteHttps: TransporteCopernicus = (url, cuerpo, cabeceras) => new Promise((resolve, reject) => {
  const destino = new URL(url);
  const req = https.request({ hostname: destino.hostname, port: destino.port || 443, path: destino.pathname + destino.search, method: 'POST', ca: CADENA_CA, headers: { ...cabeceras, 'Content-Length': Buffer.byteLength(cuerpo).toString() } }, (res) => {
    let texto = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { texto += chunk; });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, texto }));
  });
  req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`La consulta a ${destino.hostname} superó los ${TIMEOUT_MS / 1000} s.`)));
  req.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code && ERRORES_TLS.has(error.code)) { reject(new ErrorCopernicus(502, `TLS rechazado al conectar con ${destino.hostname} (${error.code}). Ejecutá npm run certs o configurá NODE_EXTRA_CA_CERTS.`)); return; }
    reject(new ErrorCopernicus(502, `No se pudo conectar con Copernicus (${error.message}).`));
  });
  req.write(cuerpo); req.end();
});

export class CopernicusClient {
  private tokenCache: { token: string; expiraEn: number; clientId: string } | null = null;
  constructor(private readonly obtenerCredenciales: () => CredencialesCopernicus = credencialesDesdeEntorno, private readonly transportar: TransporteCopernicus = transporteHttps, private readonly ahora: () => number = () => Date.now()) {}
  credencialesConfiguradas(): boolean {
    const { clientId, clientSecret } = this.obtenerCredenciales();
    return Boolean(clientId && clientSecret && !PLACEHOLDER.test(clientId) && !PLACEHOLDER.test(clientSecret));
  }
  async obtenerEstadisticas(cuerpo: string): Promise<RespuestaCopernicus> {
    if (!this.credencialesConfiguradas()) throw new ApiError(503, 'COPERNICUS_NOT_CONFIGURED', 'Copernicus no está configurado en el backend.');
    let respuesta = await this.llamarEstadisticas(await this.obtenerToken(), cuerpo);
    if (respuesta.status === 401) respuesta = await this.llamarEstadisticas(await this.obtenerToken(true), cuerpo);
    return respuesta;
  }
  private async obtenerToken(forzarRenovacion = false): Promise<string> {
    const credenciales = this.obtenerCredenciales();
    if (!forzarRenovacion && this.tokenCache && this.tokenCache.clientId === credenciales.clientId && this.ahora() < this.tokenCache.expiraEn) return this.tokenCache.token;
    const respuesta = await this.transportar(TOKEN_URL, new URLSearchParams({ grant_type: 'client_credentials', client_id: credenciales.clientId, client_secret: credenciales.clientSecret }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    if (respuesta.status !== 200) { this.tokenCache = null; throw new ApiError(502, 'COPERNICUS_AUTH_FAILED', 'Copernicus rechazó las credenciales configuradas.'); }
    let json: { access_token?: string; expires_in?: number };
    try { json = JSON.parse(respuesta.texto) as { access_token?: string; expires_in?: number }; } catch { throw new ErrorCopernicus(502, 'Copernicus devolvió una respuesta de autenticación inválida.'); }
    if (!json.access_token || typeof json.expires_in !== 'number') throw new ErrorCopernicus(502, 'Copernicus devolvió una respuesta de autenticación inválida.');
    this.tokenCache = { token: json.access_token, expiraEn: this.ahora() + Math.max(0, json.expires_in * 1000 - RENOVAR_ANTES_MS), clientId: credenciales.clientId };
    return json.access_token;
  }
  private llamarEstadisticas(token: string, cuerpo: string): Promise<RespuestaCopernicus> { return this.transportar(STATISTICS_URL, cuerpo, { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }); }
}

export const copernicus = new CopernicusClient();
