# Validación segura de PostgreSQL

## Protección de pruebas destructivas

La suite de integración contiene `TRUNCATE ... RESTART IDENTITY CASCADE`. Antes de migrar o truncar, el helper exige todas estas condiciones:

- `NODE_ENV=test` y `TEST_DATABASE_URL` con protocolo PostgreSQL.
- `DATABASE_URL` también debe estar disponible para poder comparar los destinos; si falta, el test se detiene.
- Un UUID v4 explícito en `TEST_DATABASE_DISPOSABLE_MARKER`.
- Que el host, puerto y nombre de base normalizados no coincidan con `DATABASE_URL`, aunque cambien usuario, protocolo u opciones de conexión.
- Que la base conectada coincida con el nombre de la URL y tenga el comentario exacto `RODEO_DISPOSABLE_TEST:<UUID>`.
- Un rol que sea propietario de esa base, no sea superusuario ni tenga `CREATEDB`, y tenga `CREATE` sobre la base y `public`.

Un error, falta de permiso, comentario distinto o imposibilidad de verificar identidad cancela la operación antes de migrar o truncar. La comparación de endpoint no detecta DNS alternativos que lleguen al mismo servidor; el comentario de base y el aislamiento de proyecto agregan barreras independientes.

Para preparar una base desechable después de autorizar la conexión:

1. Crear un **proyecto Neon nuevo e independiente** del proyecto de producción. No crear una rama dentro del proyecto de producción para esta suite.
2. Crear una base vacía y un rol exclusivo de tests, propietario de esa base, sin `SUPERUSER` ni `CREATEDB`. No reutilizar el rol de producción.
3. Generar un UUID v4 para esa base. Conectado administrativamente a la base nueva, establecer el comentario de base:

   ```sql
   COMMENT ON DATABASE rodeo_test IS 'RODEO_DISPOSABLE_TEST:<UUID-v4-generado>';
   ```

4. Configurar en el proceso que ejecuta tests `TEST_DATABASE_URL` y `TEST_DATABASE_DISPOSABLE_MARKER` con ese destino y UUID. No guardar la URL en el repositorio ni compartirla en logs. El proceso debe conservar `DATABASE_URL` de la aplicación para que el control compare ambos destinos.
5. Confirmar que `TEST_DATABASE_URL` no es una URL de producción y que el marcador se estableció en el proyecto nuevo. Recién con autorización explícita ejecutar `npm run test:integration`; esa suite migra y trunca repetidamente la base indicada.

La suite no se ejecutó al agregar estas protecciones. El control consulta metadatos de la conexión antes de cualquier escritura; no se usa como prueba de aislamiento del proveedor. Un proyecto Neon nuevo e independiente sigue siendo requisito.

## Registro de migraciones

Estado actual: las migraciones 001–010 están aplicadas en Neon de RODEO, rama production. La reconciliación inicial registró exactamente 001–007 usando el mecanismo y los SHA-256 locales revisados; después el migrador aplicó 008–010 y db:verify pasó. Los datos de aplicación se conservaron. Las pruebas de integración destructivas no se ejecutaron. La garantía transaccional 010 está instalada según el verificador; los casos de rollback/concurrencia en PostgreSQL y la validación funcional real desde la interfaz siguen pendientes.

El ejecutor crea `public.rodeo_schema_migrations` sólo si el esquema `public` no contiene tablas, vistas, secuencias ni objetos similares. El nombre propio evita confundirlo con el registro de otra herramienta. Guarda nombre, SHA-256 del SQL y fecha de aplicación por migración. Usa un advisory lock y transacciones individuales por archivo. Sólo acepta un historial que sea un prefijo continuo de los archivos disponibles y cuyos checksums coincidan; cualquier hueco, archivo editado o registro desconocido detiene el proceso.

Si encuentra objetos de aplicación pero no existe registro, **no infiere que 001–010 estén aplicadas** y no aplica nada. Esto es intencional mientras no se conozca el estado real de Neon. La base existente requiere reconciliación manual: inspeccionar el esquema y el historial operativo, decidir el último prefijo realmente aplicado, comprobar los checksums contra los archivos que se aplicaron y preparar una carga inicial del registro para revisión y aprobación. No ejecutar `db:migrate` para resolver esa discrepancia.

`db:verify` ahora también exige historial completo y checksums actuales. Una base sin registro o sin la migración de integridad 010 falla de manera visible.

## Atomicidad de entregas

La migración `010_entregas_notificacion_atomicas.sql` primero falla si encuentra entregas históricas incompletas que requieren reconciliación. Luego añade un constraint trigger `DEFERRABLE INITIALLY DEFERRED`. El servicio puede reclamar una entrega con `notificacion_id` nulo y vincularla después dentro de la transacción; al confirmar, PostgreSQL rechaza y revierte la transacción si la fila sigue sin notificación. Por eso la garantía ya no depende sólo de que los controladores recuerden abrir una transacción.

La migración 010 ya está aplicada en Neon `production`. El verificador de esquema pasó, pero no se ejecutó la suite destructiva. Los casos de rollback y concurrencia de PostgreSQL, además de los flujos funcionales desde la interfaz, siguen pendientes de validación. La suite de integración continúa requiriendo una base explícitamente desechable e independiente; no apuntarla al Neon habitual.