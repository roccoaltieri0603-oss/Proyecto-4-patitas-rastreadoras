import { pool } from '../src/base-datos/pool.js';
import { evaluarSchema, obtenerSnapshotSchema, tablasEsperadas } from '../src/base-datos/schema-verifier.js';

try {
  const snapshot = await obtenerSnapshotSchema(pool);
  const errores = evaluarSchema(snapshot);
  const extras = snapshot.tablas.filter((tabla) => !tablasEsperadas.includes(tabla as typeof tablasEsperadas[number]));
  if (errores.length > 0) {
    console.error('Verificación de schema fallida:');
    errores.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Schema verificado correctamente: ${tablasEsperadas.length} tablas de dominio, columnas, PK, FK, UNIQUE, CHECK e índices esenciales.`);
    if (extras.length > 0) console.log(`Tablas técnicas/adicionales detectadas: ${extras.join(', ')}.`);
  }
} finally {
  await pool.end();
}
