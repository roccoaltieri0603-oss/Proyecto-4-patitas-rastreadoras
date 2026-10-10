# Actualización del Neon existente — registro de ejecución

> **Estado al 10/10/2026:** la actualización se completó. Las migraciones 001–010 están aplicadas en Neon de RODEO, rama production; la reconciliación del historial 001–007 terminó correctamente, db:verify pasó y los datos existentes se conservaron. No se ejecutaron pruebas de integración destructivas. Las validaciones funcionales reales desde la interfaz siguen pendientes. El código nuevo aún no se publicó en GitHub ni se desplegó en Vercel.

El resto de este documento conserva la auditoría y el procedimiento que se prepararon antes de la ejecución. Sus comandos de reconciliación y migración son históricos: **no volver a ejecutarlos contra esta base**. Las comprobaciones que siguen siendo pertinentes (identidad del proyecto/branch en Vercel y workflow) se enumeran como pendientes de despliegue.

## Identidad Neon que hay que confirmar manualmente

Una sesión PostgreSQL no permite inferir de forma fiable el nombre del proyecto y la rama Neon sólo por `current_database()` y `current_user`. Antes de ejecutar cualquier escritura, abrir el proyecto Neon en uso y confirmar:

1. Proyecto y branch ID/nombre exactos del endpoint productivo de RODEO.
2. Que el endpoint, nombre de base y rol de la cadena configurada para el backend local apuntan a esa rama.
3. Que la variable `DATABASE_URL` del entorno Production de Vercel apunta a la misma rama. No copiar ni pegar la cadena en logs o chats. Si Vercel oculta el valor, confirmar la asociación mediante la integración Neon/Vercel o una revisión interna controlada del endpoint, sin revelar usuario, contraseña ni URL.
4. Que el workflow de GitHub Actions usa el mismo destino y está pausado durante la ventana de cambio.

La auditoría anterior se conectó con la configuración local del backend; **no demuestra que Vercel apunte al mismo proyecto/branch**.

## Secuencia tras autorización

Ejecutar desde PowerShell, sin cambiar variables ni archivos `.env`:

```powershell
Set-Location 'C:\Users\Rocco\OneDrive\Documentos\GitHub\Proyecto-4-patitas-rastreadoras\backend'
node --import tsx scripts/auditar-schema-readonly.mjs
```

Revisar la identidad y que los resultados sigan siendo los esperados. Confirmar en la consola Neon el proyecto y branch según la sección anterior. Pausar temporalmente el workflow `.github/workflows/actualizacion.yml` (cron diario 09:20 UTC) y coordinar la ventana de actualización. Antes de cualquier SQL, validar localmente la versión que se publicará:

```powershell
npm run typecheck
npm run build
```

Después de una autorización específica para registrar el historial:

```powershell
node --import tsx scripts/reconcile-migration-history.ts --confirmar-reconciliacion-neon
```

El runner no aplica migraciones en ese paso. Confirmar el resultado del ledger (exactamente 001–007) mediante una lectura. Luego, con autorización específica para migrar:

```powershell
npm run db:migrate
npm run db:verify
```

Con siete filas consecutivas y checksums coincidentes, `migration-runner.ts` obtiene `siguiente = 7` y ejecuta solamente los archivos ordenados 008, 009 y 010. Cada migración tiene transacción propia: si una falla, esa migración revierte y las anteriores ya confirmadas permanecen registradas. No se reejecutan 001–007.

Verificar entonces el backend publicado con los endpoints normales y datos de validación identificables, sin `npm run test:integration` (incluye truncado). Desplegar la versión de backend que requiere 008–010 después de `db:verify`; reanudar la actualización programada cuando la API esté validada.

## Impacto y límites

La reconciliación agrega el historial inicial; las migraciones 008–010 agregan tabla GPS simulada, columnas/tablas/índices/relaciones de eventos y notificaciones, y la función/trigger diferido para entregas. El SQL revisado no contiene `DROP`, `TRUNCATE`, `DELETE` ni actualizaciones de filas de aplicación. No se exige un respaldo como condición absoluta para este procedimiento incremental. El registro inicial sí es una afirmación administrativa irreversible sobre la historia, y después de que 009/010 reciban datos, quitar manualmente esos objetos puede perder información nueva.

La reconciliación 001–007 y las migraciones 008–010 se completaron en Neon `production`; `db:verify` pasó. La revisión de rama Neon debe mantenerse como comprobación de identidad operativa: la ejecución reportada fue sobre la rama `production` de RODEO. No repetir estos comandos contra la base actual. La huella MD5 descrita arriba fue una comprobación de catálogo, no una firma criptográfica.
