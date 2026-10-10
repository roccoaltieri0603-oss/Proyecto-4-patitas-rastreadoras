# Sistema de notificaciones de RODEO

Estado: las nueve notificaciones existentes siguen implementadas. El cambio local agrega ocultamiento individual de notificaciones leídas y prepara la migración 011; 011 aún no está aplicada ni este cambio está publicado. Las migraciones 001–010 ya están aplicadas en Neon de RODEO, rama `production`. La validación de estos cambios locales queda pendiente de los comandos finales indicados en el informe de tarea.

## Tipos, disparadores y destinatarios

| Tipo | Disparador | Destinatarios |
|---|---|---|
| `cambios_limites` | Cambio efectivo del polígono del establecimiento o lote | Propietarios y administradores con `editar_limite_establecimiento` o `editar_geometria_lotes`, según el alcance; se excluye al autor. Cambios repetidos de geometría de lote se agrupan por actor, establecimiento y ventana de dos minutos. |
| `permisos_modificados` | Cambio efectivo en rol/permisos/capacidades de un miembro | Propietarios; administradores autorizados a gestionar administradores; afectado si continúa como administrador. El autor se excluye. Una transacción produce un aviso consolidado por destinatario. |
| `administrador_incorporado` | Aceptación exitosa de invitación de administrador | Propietarios y administradores con `gestionar_administradores`; se excluye al autor. Crear invitación no lo dispara. |
| `administrador_eliminado` | Expulsión o degradación efectiva de administrador | Propietarios y administradores con `gestionar_administradores`; no se envía al usuario que ya perdió membresía. |
| `propiedad_principal_transferida` | Transferencia confirmada y persistida | Todos los propietarios vigentes, incluidos principal anterior y nuevo. Aviso inmediato e individual; sólo se registra dentro de la transacción confirmada. |
| `lote_eliminado` | Soft delete efectivo de lote | Propietarios y administradores con `eliminar_lotes`; excluye al autor. Avisos repetidos se agrupan, conservando cada evento auditado y la referencia histórica. |
| `satelite_optico_desactualizado` | Umbral de lotes activos sin observación válida Sentinel-2 | Propietarios y administradores con `actualizar_satelite`. Sentinel-1 y fecha de consulta no cuentan como observación óptica. |
| `fallo_actualizacion_persistente` | Tres corridas programadas consecutivas con fallo técnico de Copernicus u Open-Meteo para establecimiento/proveedor | Propietarios y administradores con el permiso de actualización del proveedor. Un éxito resuelve; `sin-datos` no es fallo técnico. |
| `gps_simulado_fuera_establecimiento` | Se guarda el marcador simulado fuera del polígono real, o el polígono editado deja afuera una posición guardada | Únicamente el administrador existente designado por un propietario. Sin designación se conserva la incidencia sin destinatario alternativo. El borde cuenta como interior. |

Los visores no reciben ni consultan la bandeja. El endpoint filtra por usuario de sesión y `establecimiento_id`; registros históricos ambiguos con establecimiento nulo no se muestran. La API no ofrece creación pública de notificaciones.

## Auditoría e idempotencia

La migración 010 agrega un constraint trigger diferido que rechaza al `COMMIT`
cualquier fila de entrega que no haya quedado vinculada a su notificación. La
validación de PostgreSQL y la reconciliación inicial del historial se describen
en [VALIDACION_POSTGRESQL_SEGURA.md](VALIDACION_POSTGRESQL_SEGURA.md); no se debe
inferir ni cargar el estado de Neon sin revisión y aprobación manual.

Las acciones administrativas escriben `eventos_establecimiento` y, cuando corresponde, notificaciones dentro de la transacción de negocio. La auditoría no depende de que exista o lea un destinatario. Los eventos individuales se conservan aunque sus notificaciones se agrupen. Las tablas de incidencias guardan episodio activo/resuelto y fechas; `read_at` sólo indica lectura. Índices únicos parciales en PostgreSQL protegen incidencias activas y deduplicación bajo concurrencia. El resultado de cada ejecución programada de proveedor tiene clave idempotente.

## Criterios provisionales de datos

- Frescura óptica: 14 días desde la última observación válida Sentinel-2. Para un lote sin observación se aplica una gracia de 14 días desde su creación.
- Umbral por establecimiento: 1 lote vencido cuando hay hasta 5 lotes activos; con más de 5, máximo entre 2 y el 10% redondeado hacia arriba.
- Fallo persistente: tres ejecuciones programadas consecutivas por proveedor y establecimiento; el éxito reinicia/resuelve el episodio.
- El error de persistencia de base de datos se informa separadamente, no como fallo del proveedor.

Son umbrales iniciales configurables en servicio; requieren validación de producto antes de considerarse definitivos.

## GPS simulado y alcance excluido

El marcador rojo sigue siendo una simulación y no telemetría de animales. Se evalúa sólo al guardar una posición válida; nunca se genera un evento desde el centroide no persistido ni durante el arrastre visual. Se utiliza la geometría del backend y Turf, con borde incluido. El propietario designa un único miembro actual ADMINISTRADOR en la gestión del equipo. Al remover/degradar ese miembro, la relación se elimina. No se agregan cuenta compartida, rol, animales, lotes asignados ni rutas.

Queda expresamente pendiente diseñar asignaciones de lote, animales/dispositivos, jornadas, rutas y tolerancias. No alertar por salida de lote asignado. También quedan fuera GPS sin señal, batería, movimiento anormal y cambios de IA.

## Configuración y endpoints

- Notificaciones: `/api/establecimientos/:establecimientoId/notificaciones` lista y pagina avisos visibles; permite marcar leído individual/masivo y ocultar individualmente los ya leídos con `DELETE /:id`.
- Designación GPS: `PATCH /api/establecimientos/:establecimientoId/equipo/responsable-gps`, cuerpo `{ "userId": UUID | null }`; sólo propietario, sólo miembro ADMINISTRADOR vigente.
- La lista de equipo incluye `responsableGpsUserId`; el aviso de configuración ausente se muestra a propietarios.
- Frontend usa el cliente común `src/api/client.ts` y refresca el panel con frecuencia moderada sólo mientras la pestaña está visible.

## Esquema agregado

Migración incremental `backend/migrations/009_notificaciones_inteligentes.sql`: agrega `establecimiento_id`, `evento_id`, `incidencia_id` y `agrupacion_clave` a notificaciones; relaciones compuestas para impedir mezcla de establecimiento; tablas `eventos_establecimiento`, `entregas_eventos_notificacion`, `incidencias_establecimiento`, `responsable_gps_notificaciones`, `estado_fallos_actualizacion` y `ejecuciones_actualizacion_proveedor`; restricciones e índices de aislamiento e idempotencia. La entrega administrativa tiene clave única `(evento_id, user_id)` y referencia a la notificación entregada, incluida cuando varios eventos se agrupan en una sola fila de bandeja. No reescribe migraciones históricas ni inventa afiliación para notificaciones ambiguas.

Estado de base: las migraciones 001–010 ya se aplicaron en Neon de RODEO, rama `production`; la reconciliación 001–007 y `db:verify` pasaron, conservando los datos existentes. No se ejecutaron pruebas de integración destructivas. La comprobación funcional real desde la interfaz sigue pendiente; no repetir migraciones en esta base.

## Verificación

Se agregaron pruebas unitarias e integración para destinatarios, aislamiento, visor, episodios, GPS y señales automáticas. Véase el informe de tarea para resultados ejecutados; no considerar validado en producción sin aplicar/verificar esquema en entorno de prueba.

## Ocultamiento individual (migración 011 pendiente)

`deleted_at` marca la ocultación por destinatario. El endpoint `DELETE
/api/establecimientos/:establecimientoId/notificaciones/:id` exige sesión,
membresía no VISOR, pertenencia al usuario y establecimiento actual, y que
`read_at` ya tenga valor. Devuelve 204 al ocultar; devuelve 409 si está sin
leer y 404 si no es visible para esa sesión. Listado, conteos y marcado masivo
omiten `deleted_at IS NOT NULL`.

La fila de `notificaciones` se conserva, por lo que las FKs y el constraint
trigger diferido de la migración 010 siguen teniendo su destino. Los grupos
administrativos reactivos pueden volver a mostrarse con actividad nueva: el
upsert agrupado limpia `deleted_at` y `read_at` al sumar un evento cuya entrega
idempotente se acaba de reclamar. Una repetición del mismo evento no reclama
otra entrega y no resucita ni incrementa el grupo. Las notificaciones de una
incidencia conservan `ON CONFLICT DO NOTHING`; una incidencia persistente no
resucita una fila oculta. Un episodio nuevo tiene otro ID de incidencia y puede
generar un aviso nuevo.
