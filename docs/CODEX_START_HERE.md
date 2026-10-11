# Codex — empezar acá

**Estado del trabajo local al 11/10/2026:** Neon `production` tiene 001–011; el código y la migración 012 de cuentas operativas compartidas no están aplicados ni publicados. Ver [CUENTAS_OPERATIVAS.md](CUENTAS_OPERATIVAS.md). Los estados anteriores de este documento son históricos.

Este archivo no reemplaza `AGENTS.md`: primero leer `AGENTS.md` y toda la documentación indicada allí.

## Contexto

Frontend y backend reales ya funcionan y no deben reescribirse. La tarea es
evolucionarlos incrementalmente conservando mapa, contratos y datos.

La base de producción ya incluye configuración validada, CORS/cookies
configurables, Helmet, límite de body, rate limit de auth, request IDs, logs,
health checks y graceful shutdown. El frontend usa `src/api/client.ts` como
punto único y admite `VITE_API_BASE_URL`. Ver `docs/DEPLOYMENT.md` antes de
cambiar infraestructura.

## Estado frontend actual

El gateway de Copernicus ya vive en Express y Vite sÃ³lo lo proxifica. Las
credenciales se configuran manualmente en `backend/.env`; el frontend no las
lee.

El onboarding visual, la persistencia de establecimiento/lotes y la ficha
completa `/lotes/:id` ya están implementados. Mantener el mapa y no reintroducir
`localStorage` como fuente de verdad.

## Estado de integraciones externas

Copernicus y Open-Meteo se consumen mediante Express; Vite sÃ³lo proxifica sus
endpoints. Open-Meteo no requiere API key y el frontend conserva fachadas
compatibles para el mapa y la ficha. Ambos flujos persisten desde backend; el
navegador no envía observaciones como autoridad.

## Notificaciones

La infraestructura incluye API privada, panel en Sidebar, badge y marcado individual/masivo. Los nueve tipos de notificación funcionan en la versión publicada; ver `docs/NOTIFICACIONES.md`. No hay endpoint público de creación. Neon `production` tiene 001–011. La bandeja por puesto de 012 es local y no está validada con PostgreSQL real. La salida de lote asignado está expresamente excluida.

## Estado satelital vigente

La actualización Copernicus completa vive en backend: lote/polígono, request,
evalscripts, interpretación, scoring provisional y persistencia. El frontend
usa los endpoints individual y batch enviando sólo IDs. No reintroducir bodies
Statistical API, geometrías, evalscripts ni persistencia satelital en el
navegador; `/api/copernicus/statistics` ya no se expone.

## Primera tarea recomendada

## Estado vigente del repositorio

El bootstrap del backend y la migración gradual inicial ya se completaron. Neon `production` tiene 001–011 y las nueve notificaciones publicadas. El nuevo código de puestos y la migración 012 siguen sólo locales. Las pruebas de integración destructivas de este rediseño no se ejecutaron.

Las instrucciones de bootstrap que siguen se conservan como historial. No describen trabajo pendiente ni deben usarse para volver a conectar o migrar Neon.
### Entregables de la primera tarea

1. Crear carpeta `backend/` con proyecto Node.js + TypeScript.
2. Agregar servidor HTTP sencillo con Express.
3. Agregar `GET /api/health` que responda JSON.
4. Preparar conexión a PostgreSQL mediante variable `DATABASE_URL`.
5. Crear `.env.example` sin secretos reales.
6. Crear mecanismo de schema/migraciones versionado en el repo.
7. Implementar las tablas de `docs/DATABASE_MODEL.md`.
8. Agregar índices y constraints básicos.
9. Neon ya está conectado y el esquema 001–011 aplicado en la rama `production`; no ejecutar 012 sin autorización explícita.
10. Agregar comandos claros para:
   - instalar dependencias;
   - iniciar backend en desarrollo;
   - aplicar schema/migraciones;
   - ejecutar checks de TypeScript.
11. Actualizar README/documentación con esos comandos.

## Reglas de implementación

- No usar SQLite como sustituto: el objetivo es PostgreSQL.
- No hardcodear credenciales.
- No crear datos simulados permanentes en tablas productivas.
- No agregar animales/GPS.
- No agregar ML.
- No agregar roles.
- No borrar `localStorage` todavía; esa migración viene después.
- No modificar el mapa actual en esta primera tarea.
- Mantener nombres y comentarios en español cuando sea razonable.

## Esquema esperado

Tablas:

```text
usuarios
establecimientos
lotes
mediciones_satelitales
consultas_clima
dias_clima
notificaciones
```

Leer `docs/DATABASE_MODEL.md` antes de escribir SQL.

## Después de esta primera tarea

No continuar automáticamente con auth sin revisar el resultado. La siguiente fase será:

- registro/login;
- sesión;
- onboarding;
- endpoints de establecimiento/lotes;
- migración de persistencia desde localStorage.

## Validación

Al terminar informar:

- archivos creados/modificados;
- decisiones técnicas tomadas y por qué;
- comandos ejecutados;
- resultado de build/typecheck;
- cualquier desviación de la documentación;
- preguntas que requieran decisión del equipo.
