# AGENTS.md — instrucciones para Codex y otros agentes

Antes de modificar este repositorio, leer en este orden:

1. `README.md`
2. `docs/PROJECT_DIRECTION.md`
3. `docs/AUTH_ONBOARDING.md`
4. `docs/DATABASE_MODEL.md`
5. `docs/API_CONTRACTS.md`
6. `docs/IMPLEMENTATION_PLAN.md`
7. `docs/OPEN_QUESTIONS.md`
8. `CLAUDE.md`

## Regla principal

No romper ni reescribir el mapa actual si no es necesario. El mapa, el dibujo de establecimiento/lotes, Leaflet Draw, Turf, Copernicus, Open-Meteo y los paneles actuales ya funcionan y son la base que se debe conservar.

## Estado de arquitectura

El repositorio nació como frontend solamente, pero esa restricción quedó levantada. A partir de esta etapa se debe construir el backend real del proyecto.

Objetivo inmediato:

- autenticación con usuario + contraseña;
- PostgreSQL como persistencia real;
- Neon será el PostgreSQL remoto cuando se conecte;
- un usuario tiene un único establecimiento por ahora;
- un establecimiento tiene muchos lotes;
- onboarding obligatorio: establecimiento + mínimo un lote;
- persistencia histórica de datos satelitales y climáticos;
- base de notificaciones preparada;
- todavía NO agregar vacas/GPS/ML.

## Datos: regla que no se rompe

Nunca inventar datos. Si Copernicus u Open-Meteo no devuelven información válida, guardar/mostrar ausencia de datos o error explícito; no fabricar números para completar UI.

Las observaciones de Copernicus/Open-Meteo se generan y persisten desde el backend. El frontend sólo envía IDs/intención; no reintroducir endpoints que acepten valores externos calculados por el navegador como autoridad.

Sentinel-1 y Sentinel-2 son fuentes físicamente distintas. No combinarlas como si fueran la misma medición ni dar un puntaje óptico falso a una observación de radar.

## Geometría

El frontend ya usa GeoJSON `Feature<Polygon>` y Turf. Mantener ese formato. En la primera versión del backend, almacenar los polígonos como `JSONB` en PostgreSQL para evitar una migración innecesaria del mapa.

No introducir PostGIS todavía salvo que una necesidad concreta lo justifique.

Reglas espaciales:

- un lote nuevo debe quedar completamente dentro del establecimiento;
- lotes no eliminados no deben superponerse en área;
- al editar el límite del establecimiento, NO se puede guardar si algún lote no eliminado queda parcial o totalmente afuera;
- si una edición es inválida, rechazarla y conservar/restaurar la geometría anterior.

## Borrado

Los lotes se eliminan con soft delete (`deleted_at`), no con DELETE físico, para conservar historial satelital, climático y futuro historial de uso.

Una vez terminado el onboarding, borrar o desactivar todos los lotes NO vuelve a bloquear la aplicación.

## Seguridad

- `username` único;
- jamás guardar contraseñas en texto plano;
- guardar sólo `password_hash`;
- secretos de Copernicus y PostgreSQL sólo del lado servidor / `.env` gitignored;
- nunca exponer `COPERNICUS_CLIENT_SECRET` al navegador.
- todas las llamadas HTTP del frontend a la API deben pasar por `src/api/client.ts`
  para respetar `VITE_API_BASE_URL` y `credentials: "include"`;
- preservar validación de entorno, CORS explícito, cookies seguras, Helmet,
  límite de body, rate limit de auth, request IDs y cierre ordenado.
- nunca ejecutar integraciones destructivas contra `DATABASE_URL`; requieren
  `TEST_DATABASE_URL` distinta, sin fallback;
- aplicar migraciones forward primero en test, ejecutar `db:verify` y recién
  después considerar la base principal.

## Estilo del código

- nombres, comentarios y texto de UI en español cuando tenga sentido;
- comentarios sólo para explicar decisiones no obvias;
- TypeScript estricto;
- evitar dependencias innecesarias;
- cambios pequeños y comprobables;
- no borrar funcionalidad existente para “simplificar” una tarea.

## Organización del backend

- conservar las capas profesionales `routes`, `controllers` y `services`;
- autenticación interna vive en `backend/src/autenticacion`;
- configuración de entorno vive en `backend/src/configuracion`;
- conexión y verificación PostgreSQL viven en `backend/src/base-datos`;
- helpers transversales del protocolo permanecen en `backend/src/http`;
- no reintroducir las carpetas abreviadas antiguas `auth`, `config` o `db`.

## Antes de cerrar una tarea

Como mínimo:

- ejecutar `npx tsc --noEmit` para frontend cuando corresponda;
- ejecutar `npm run build` cuando corresponda;
- si se agrega backend, ejecutar sus checks/tests o al menos levantarlo y probar endpoints relevantes;
- actualizar documentación cuando cambie una decisión, endpoint, tabla o flujo importante.

No asumir que una decisión pendiente ya fue tomada: revisar `docs/OPEN_QUESTIONS.md`.
