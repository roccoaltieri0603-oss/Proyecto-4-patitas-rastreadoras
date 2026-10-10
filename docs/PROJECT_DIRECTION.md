# Dirección actual de RODEO

Estado vigente: el modelo es multiusuario, con roles PROPIETARIO, ADMINISTRADOR y VISOR, y se conserva el mapa existente. Las migraciones 001–010 están aplicadas en Neon de RODEO, rama `production`; la reconciliación 001–007 se completó y `db:verify` pasó, conservando los datos. Las nueve notificaciones están implementadas; pasaron 268 pruebas unitarias y los builds frontend/backend. No se ejecutaron pruebas de integración destructivas; las pruebas funcionales reales desde la interfaz siguen pendientes. El código nuevo no está publicado ni desplegado.

Las secciones de planificación posteriores conservan decisiones históricas y no reemplazan el modelo multiusuario vigente. La eliminación de establecimientos sigue bloqueada hasta definir su semántica.

## Objetivo de esta etapa

El repositorio tiene un frontend funcional y ya cuenta con usuarios,
autenticación, backend y PostgreSQL/Neon. La etapa siguiente completa la
persistencia real del establecimiento y los lotes del mapa.

No se debe rehacer el mapa. Se debe conservar la arquitectura actual y conectarla a persistencia real.

## Qué ya existe y se conserva

- React + TypeScript + Vite.
- Leaflet / React-Leaflet.
- Leaflet Draw para dibujar y editar polígonos.
- Turf para validaciones geométricas.
- Un único establecimiento en el estado actual.
- Lotes numerados automáticamente.
- Apodo opcional para lotes.
- Nombre obligatorio del establecimiento.
- Activar/desactivar lotes.
- Cálculo de hectáreas.
- Copernicus Data Space con Sentinel-2 L2A.
- Sentinel-1 GRD como respaldo de radar.
- NDVI, NDMI, NDWI, EVI y RVI.
- Puntaje 0–100 para la condición óptica actual.
- Alertas de condición.
- Tendencia de últimas observaciones despejadas.
- Open-Meteo por centroide de lote.
- Lluvia de últimos 7 días, pronóstico y temperatura.

## Qué deja de ser definitivo

Actualmente establecimiento y lotes se guardan en PostgreSQL/Neon mediante las
APIs privadas del backend. `localStorage` ya no es fuente de verdad.

La fuente definitiva es PostgreSQL. No se migran automáticamente datos locales
antiguos; un usuario recupera establecimiento y lotes desde cualquier
dispositivo mediante su sesión autenticada.

## Nueva arquitectura objetivo

## Estado real de cierre de etapa

La etapa de onboarding visual y persistencia de establecimiento/lotes ya fue
implementada. El frontend usa Neon como fuente real y no consulta `localStorage`
para esos datos.

La base de backend y autenticación ya está implementada: PostgreSQL en Neon,
registro/login/logout, `auth/me`, bcrypt, JWT en cookie HttpOnly, APIs privadas
de establecimiento y lotes, validaciones geométricas, soft delete, numeración
histórica y finalización irreversible del onboarding. El frontend ya consume
la autenticación real y conserva el mapa mediante `App`/`RodeoApp`.

Copernicus no es requisito para arrancar Vite. Las credenciales opcionales son
`COPERNICUS_CLIENT_ID` y `COPERNICUS_CLIENT_SECRET`, sólo del lado Node/Vite y
sin prefijo `VITE_`; Open-Meteo no requiere credenciales.

```text
Frontend React
    |
    v
API HTTP
    |
    v
Backend Node.js
    |
    +--> PostgreSQL / Neon
    |
    +--> Copernicus
    |
    +--> Open-Meteo (consulta y persistencia backend-owned)
```

Copernicus y Open-Meteo ya se consumen desde Express. El frontend solicita
actualizaciones por IDs y nunca actúa como autoridad de observaciones externas.

## Decisiones cerradas

### Usuarios

- registro con `username` + contraseña;
- `username` único;
- contraseña guardada exclusivamente como hash;
- sin roles todavía;
- sin email obligatorio por ahora.

### Establecimiento

- un usuario puede tener sólo un establecimiento en esta versión;
- el nombre del establecimiento sigue siendo obligatorio;
- el establecimiento se dibuja con el mapa actual;
- su polígono se guarda en PostgreSQL como GeoJSON `JSONB`.

### Lotes

- un establecimiento tiene muchos lotes;
- número automático por establecimiento;
- apodo opcional;
- activo/inactivo;
- soft delete para conservar historia;
- un lote eliminado deja de mostrarse como normal, pero sus datos históricos siguen existiendo.

### Onboarding

Para terminar el onboarding deben existir:

1. una cuenta registrada;
2. un establecimiento;
3. al menos un lote creado.

Al completarse se guarda `onboarding_completed_at`.

Una vez completado, no se revierte automáticamente aunque el usuario después desactive o elimine todos los lotes.

Si el usuario cierra sesión antes de completar el onboarding, el siguiente login debe devolverlo al flujo de onboarding.

### Geometría

Mantener el mapa actual y el mismo formato GeoJSON.

Reglas:

- lote completamente contenido en establecimiento;
- lotes no eliminados sin superposición de área;
- al editar el establecimiento no se puede guardar una geometría que deje algún lote no eliminado afuera;
- una edición inválida se rechaza y se restaura/conserva el límite anterior.

### Datos satelitales

Guardar cada observación real recuperada, no sólo el último valor.

No sobrescribir una medición anterior con una nueva.

Sentinel-1 y Sentinel-2 permanecen diferenciados.

### Clima

Guardar cada consulta de clima y los días que devolvió esa consulta. Esto conserva tanto observaciones pasadas como la evolución del pronóstico a través del tiempo.

### Notificaciones

Preparar modelo y endpoints base aunque el diseño final de UI y los tipos definitivos todavía no estén cerrados.

### Fuera de alcance inmediato

Todavía no implementar:

- vacas;
- dispositivos GPS;
- posiciones GPS;
- jornadas de pastoreo;
- planificación automática multi-día definitiva;
- machine learning;
- roles/permisos entre usuarios.

Esas capas se incorporarán después de tener sólida la base de usuarios, establecimiento, lotes e historial.
