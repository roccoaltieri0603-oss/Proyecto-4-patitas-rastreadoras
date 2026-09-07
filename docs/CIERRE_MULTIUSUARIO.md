# Cierre de feature/multiusuario

## Estado entregado

Se continuó el trabajo existente sin reiniciar ni descartar cambios válidos.
Antes de este cierre ya estaban implementados membresías, múltiples
establecimientos, contexto explícito, roles/permisos, equipo, invitaciones,
transferencia, controles frontend y lectura compartida. Habían pasado builds,
228 pruebas unitarias y 40 comprobaciones de UI con API simulada.

En la continuación completa se revisaron backend, frontend, nuevas tablas,
autorización y regresiones. Se mantuvo la transferencia resuelta: el antiguo
principal sigue como PROPIETARIO con acceso operativo completo, pero sin ninguna
de las seis capacidades especiales. Se retiró la decisión previa de soft delete
de establecimientos de migración, schema verifier y flujo de eliminación.
La operación queda bloqueada, sin mutaciones ni nueva semántica de borrado.

En el cierre final se corrigieron:

- Tests de integración de IA que todavía llamaban rutas antiguas; ahora usan
  establecimiento explícito, crean el contexto necesario y confirman con `origen: ia`.
- Formulario de nuevo uso visible sin permiso; se oculta completo.
- Mensaje de transferencia: explicita pérdida de todas las capacidades especiales.
- Fallas inesperadas de DB al aceptar códigos: ya no se convierten en “invitación
  inválida”; se preserva el error y se revierte la transacción.
- Documentación anterior de rutas, onboarding global y relación 1:1; se documenta
  el modelo vigente y se señalan las secciones históricas reemplazadas.

Se agregaron tres regresiones unitarias: rechazo del UNIQUE anterior,
obligatoriedad de la FK de principal y diferenciación entre falla DB y código
inválido. Se conservaron las adaptaciones previas de favoritos, notificaciones,
tests y smoke; no se ejecutaron los scripts smoke.

El modelo, los 19 permisos, las seis capacidades, las rutas, el onboarding y
las limitaciones de lectura están en [MULTIUSUARIO.md](MULTIUSUARIO.md).

## Verificaciones finales

| Verificación ejecutada | Resultado |
| --- | --- |
| `npx.cmd tsc --noEmit` | Exit 0 |
| `npm.cmd run typecheck --workspace backend` | Exit 0 |
| `npm.cmd run test:typecheck --workspace backend` | Exit 0 |
| `npm.cmd run build` | Exit 0; Vite 457 módulos |
| `npm.cmd run build --workspace backend` | Exit 0 |
| `npm.cmd run test:unit --workspace backend` | **231 passed, 21 test files passed**, exit 0 |
| QA navegador con API simulada, repetida tras los últimos cambios de UI | **40 comprobaciones aprobadas** |
| Viewport móvil real emulado con CDP | `innerWidth = 390`, `scrollWidth = 390`; captura inspeccionada |
| `git diff --check` | Exit 0, sin problemas de whitespace |

Vite informa el aviso de chunk mayor de 500 kB: JS principal de 576,85 kB
(171,80 kB gzip). No bloquea el build; no se agregó una reestructuración de bundles.

## No ejecutado y pendientes

- **Migración 006 NO aplicada.** No se ejecutó `db:migrate` ni otra migración.
- `db:verify` contra PostgreSQL no ejecutado: el schema nuevo todavía no fue aplicado.
- Integración real no ejecutada: requiere `TEST_DATABASE_URL` independiente y su
  preparación migra/limpia datos. No se utilizó `DATABASE_URL` como fallback.
- No se ejecutaron smoke ni consultas reales a Copernicus/Open-Meteo/servicio IA.
- La aceptación concurrente, los locks/FKs y el backfill fueron revisados y tienen
  cobertura preparada, pero faltan su ejecución y validación en PostgreSQL real.
- Sigue pendiente definir la eliminación final de establecimientos. El principal
  real recibe 409 mientras haya lotes no eliminados y 501 cuando no los hay.
- El frontend y backend nuevos requieren la migración 006. Las rutas antiguas
  sin establecimiento explícito no son compatibles con este contrato nuevo.

No se modificaron entorno, producción, autenticación, configuración de Vercel,
algoritmos de IA/scoring ni el motor del mapa. No hubo commit, push, merge ni deploy.

## Artefactos temporales

Se verificó con `git ls-files` que `.tsbuild/multiusuario` no tenía archivos
trackeados y con `git check-ignore` que lo cubría la regla `.tsbuild/` existente.
Contenía harness de QA, bundle, resultados, capturas y perfiles temporales de Edge.
El archivo `browser.tsx.tsbuild` mencionado no estaba presente como archivo fuente
ni trackeado. Se cerraron el navegador y servidor de QA y se eliminó únicamente
esa carpeta temporal, comprobando antes su ruta absoluta dentro del repositorio
y ausencia de enlaces. No se tocaron otros directorios temporales anteriores.

## Comandos para ejecutar manualmente después

Desde la raíz, comprobando que el entorno backend apunta a **multiusuario-test**:

```powershell
npm.cmd run db:migrate --workspace backend
npm.cmd run build --workspace backend
npm.cmd run db:verify --workspace backend
```

El nombre de la rama Neon no se pasa como argumento: los comandos usan el entorno
existente del backend. El build intermedio garantiza que `db:verify` usa el
verificador actualizado. Estos comandos se entregan para ejecución manual.

## Git al finalizar

La salida siguiente lista todos los archivos modificados y nuevos. `git diff
--stat` incluye solamente archivos ya trackeados; los nuevos se listan aparte.

### git status

```text
On branch feature/multiusuario
Your branch is up to date with 'origin/feature/multiusuario'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   CLAUDE.md
	modified:   README.md
	modified:   backend/scripts/smoke-cleanup.ts
	modified:   backend/scripts/smoke-ia.ts
	modified:   backend/scripts/smoke.ts
	modified:   backend/src/app.mts
	modified:   backend/src/base-datos/schema-verifier.ts
	modified:   backend/src/controllers/clima.ts
	modified:   backend/src/controllers/establecimiento.ts
	modified:   backend/src/controllers/historial.ts
	modified:   backend/src/controllers/ia.ts
	modified:   backend/src/controllers/lotes.ts
	modified:   backend/src/controllers/notificaciones.ts
	modified:   backend/src/controllers/satelite.ts
	modified:   backend/src/controllers/simulacion.ts
	modified:   backend/src/routes/clima.ts
	modified:   backend/src/routes/historial.ts
	modified:   backend/src/routes/ia.ts
	modified:   backend/src/routes/lotes.ts
	modified:   backend/src/routes/notificaciones.ts
	modified:   backend/src/routes/satelite.ts
	modified:   backend/src/routes/simulacion.ts
	modified:   backend/src/services/lotes-favoritos.ts
	modified:   backend/src/types/express.d.ts
	modified:   backend/tests/integration/api.test.ts
	modified:   backend/tests/unit/actualizacion-programada.test.ts
	modified:   backend/tests/unit/lotes-favoritos.test.ts
	modified:   backend/tests/unit/schema-verifier.test.ts
	modified:   backend/tests/unit/smoke-cleanup.test.ts
	modified:   docs/API_CONTRACTS.md
	modified:   docs/AUTH_ONBOARDING.md
	modified:   docs/DATABASE_MODEL.md
	modified:   docs/IMPLEMENTATION_PLAN.md
	modified:   docs/OPEN_QUESTIONS.md
	modified:   docs/PROJECT_DIRECTION.md
	modified:   src/App.tsx
	modified:   src/api/historial.ts
	modified:   src/api/ia.ts
	modified:   src/api/notificaciones.ts
	modified:   src/api/rodeo.ts
	modified:   src/api/simulacion.ts
	modified:   src/clima/api.ts
	modified:   src/components/ClimaPanel.tsx
	modified:   src/components/CondicionPanel.tsx
	modified:   src/components/Sidebar.tsx
	modified:   src/components/SimulacionPastoreoPanel.tsx
	modified:   src/components/SugerenciasPanel.tsx
	modified:   src/copernicus/api.ts
	modified:   src/hooks/useNotificaciones.ts
	modified:   src/pages/HomePage.tsx
	modified:   src/pages/LotePage.tsx
	modified:   src/types.ts

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	backend/migrations/006_multiusuario.sql
	backend/src/autorizacion/catalogo.ts
	backend/src/autorizacion/membresia.ts
	backend/src/autorizacion/reglas.ts
	backend/src/controllers/equipo.ts
	backend/src/routes/establecimientos.ts
	backend/src/services/equipo.ts
	backend/src/services/lecturas-compartidas.ts
	backend/tests/unit/lecturas-compartidas.test.ts
	backend/tests/unit/multiusuario-equipo.test.ts
	backend/tests/unit/multiusuario-http.test.ts
	backend/tests/unit/multiusuario-reglas.test.ts
	docs/CIERRE_MULTIUSUARIO.md
	docs/MULTIUSUARIO.md
	src/api/establecimientos.ts
	src/hooks/useEstablecimiento.tsx
	src/pages/EquipoPage.tsx
	src/pages/EstablecimientosPage.tsx

no changes added to commit (use "git add" and/or "git commit -a")
```

### git diff --stat

```text
 CLAUDE.md                                          |   6 +
 README.md                                          |   7 +
 backend/scripts/smoke-cleanup.ts                   |   6 +
 backend/scripts/smoke-ia.ts                        |  20 +-
 backend/scripts/smoke.ts                           |   8 +-
 backend/src/app.mts                                |  18 +-
 backend/src/base-datos/schema-verifier.ts          |  26 +-
 backend/src/controllers/clima.ts                   |  15 +-
 backend/src/controllers/establecimiento.ts         |  59 ++--
 backend/src/controllers/historial.ts               |  39 ++-
 backend/src/controllers/ia.ts                      |   9 +-
 backend/src/controllers/lotes.ts                   |  28 +-
 backend/src/controllers/notificaciones.ts          |  13 +-
 backend/src/controllers/satelite.ts                |  15 +-
 backend/src/controllers/simulacion.ts              |  13 +-
 backend/src/routes/clima.ts                        |  10 +-
 backend/src/routes/historial.ts                    |  12 +-
 backend/src/routes/ia.ts                           |   8 +-
 backend/src/routes/lotes.ts                        |  14 +-
 backend/src/routes/notificaciones.ts               |   5 +-
 backend/src/routes/satelite.ts                     |  10 +-
 backend/src/routes/simulacion.ts                   |   5 +-
 backend/src/services/lotes-favoritos.ts            |   8 +-
 backend/src/types/express.d.ts                     |   2 +
 backend/tests/integration/api.test.ts              | 372 +++++++++++++--------
 .../tests/unit/actualizacion-programada.test.ts    |   5 +
 backend/tests/unit/lotes-favoritos.test.ts         |   8 +-
 backend/tests/unit/schema-verifier.test.ts         |  12 +
 backend/tests/unit/smoke-cleanup.test.ts           |  13 +-
 docs/API_CONTRACTS.md                              |  92 ++---
 docs/AUTH_ONBOARDING.md                            |  13 +
 docs/DATABASE_MODEL.md                             |  11 +
 docs/IMPLEMENTATION_PLAN.md                        |  10 +
 docs/OPEN_QUESTIONS.md                             |  16 +
 docs/PROJECT_DIRECTION.md                          |   9 +
 src/App.tsx                                        |  19 +-
 src/api/historial.ts                               |  30 +-
 src/api/ia.ts                                      |   8 +-
 src/api/notificaciones.ts                          |  12 +-
 src/api/rodeo.ts                                   |  38 ++-
 src/api/simulacion.ts                              |   4 +-
 src/clima/api.ts                                   |   8 +-
 src/components/ClimaPanel.tsx                      |   4 +-
 src/components/CondicionPanel.tsx                  |   4 +-
 src/components/Sidebar.tsx                         |  37 +-
 src/components/SimulacionPastoreoPanel.tsx         |   4 +-
 src/components/SugerenciasPanel.tsx                |   6 +-
 src/copernicus/api.ts                              |   8 +-
 src/hooks/useNotificaciones.ts                     |  10 +-
 src/pages/HomePage.tsx                             |  62 ++--
 src/pages/LotePage.tsx                             |  44 ++-
 src/types.ts                                       |   1 +
 52 files changed, 769 insertions(+), 447 deletions(-)
```

### Archivos nuevos

```text
backend/migrations/006_multiusuario.sql
backend/src/autorizacion/catalogo.ts
backend/src/autorizacion/membresia.ts
backend/src/autorizacion/reglas.ts
backend/src/controllers/equipo.ts
backend/src/routes/establecimientos.ts
backend/src/services/equipo.ts
backend/src/services/lecturas-compartidas.ts
backend/tests/unit/lecturas-compartidas.test.ts
backend/tests/unit/multiusuario-equipo.test.ts
backend/tests/unit/multiusuario-http.test.ts
backend/tests/unit/multiusuario-reglas.test.ts
docs/CIERRE_MULTIUSUARIO.md
docs/MULTIUSUARIO.md
src/api/establecimientos.ts
src/hooks/useEstablecimiento.tsx
src/pages/EquipoPage.tsx
src/pages/EstablecimientosPage.tsx
```
