/**
 * Exporta las CAs raíz del almacén de certificados de Windows a `certs/corp-ca.pem`.
 *
 * Hace falta cuando la red de la empresa hace inspección TLS: el navegador
 * confía en la CA interna porque la lee del almacén de Windows, pero Node no,
 * y toda llamada a Copernicus muere con SELF_SIGNED_CERT_IN_CHAIN.
 *
 *   npm run certs
 *
 * El plugin de Vite levanta solo cualquier .pem que encuentre en `certs/`.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const ejecutar = promisify(execFile);
const DESTINO = "certs/corp-ca.pem";

const PS = `
$salida = @()
foreach ($almacen in @('Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\CA')) {
  if (Test-Path $almacen) {
    Get-ChildItem $almacen | ForEach-Object {
      $b64 = [System.Convert]::ToBase64String($_.RawData, 'InsertLineBreaks')
      $salida += "# $($_.Subject)\`n-----BEGIN CERTIFICATE-----\`n$b64\`n-----END CERTIFICATE-----"
    }
  }
}
$salida -join "\`n" | Out-File -FilePath '${DESTINO}' -Encoding ascii
`;

if (process.platform !== "win32") {
  console.error(
    "Este script exporta el almacén de certificados de Windows y sólo corre en Windows.\n" +
      "En Linux/macOS, apuntá NODE_EXTRA_CA_CERTS al bundle de tu organización, o dejá un .pem en certs/.",
  );
  process.exit(1);
}

mkdirSync("certs", { recursive: true });

try {
  await ejecutar("powershell.exe", ["-NoProfile", "-Command", PS], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const cantidad = (readFileSync(DESTINO, "utf8").match(/BEGIN CERTIFICATE/g) ?? []).length;
  if (cantidad === 0) throw new Error("no se exportó ningún certificado");
  console.log(`✓ ${cantidad} certificados exportados a ${DESTINO}`);
  console.log("  Reiniciá el dev-server para que los tome.");
} catch (error) {
  console.error(`✗ No se pudo exportar el almacén de Windows: ${error.message}`);
  process.exit(1);
}
