# Sistema de notificaciones de RODEO

> Estado actualizado al 26/10/2026: una consulta de solo lectura a Neon registro 001-021. Las menciones en esta pagina que digan que 013-021 siguen locales o pendientes estan superadas y son historicas; el historial de migraciones no acredita por si solo el despliegue del codigo.

Estado al 11/10/2026: las nueve notificaciones compartidas, el ocultamiento de 011 y la bandeja por puesto de 012 están publicados; Neon `production` tiene 001–012 y `db:verify` pasó. La tanda actual agrega avisos personales independientes y es local. La migración 013 todavía no está aplicada ni publicada. Las reglas históricas por usuario que siguen abajo describen la versión anterior; consultar [CUENTAS_OPERATIVAS.md](CUENTAS_OPERATIVAS.md) para puestos operativos.

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
| `gps_simulado_en_lote` | Se guarda el marcador simulado dentro de un lote activo distinto del de su posición anterior (22/10/2026) | Todos los puestos activos de propietario y administrador, autor incluido. Moverlo dentro del mismo lote o sacarlo de todos no avisa. Texto rotulado "Simulación de GPS · no es un dato real". Se puede borrar sin leer. |

Los visores no reciben ni consultan la bandeja compartida. La versión publicada filtra por puesto y establecimiento, conservando filas históricas sólo para su usuario original. La nueva bandeja personal es otro endpoint autenticado y limita cada operación al usuario de la sesión personal; esa ruta depende de 013, todavía local. La API no ofrece creación pública de notificaciones.

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

Estado de base: las migraciones 001–012 ya se aplicaron en Neon de RODEO, rama `production`; la reconciliación 001–007 se completó conservando los datos. 013 corresponde sólo a la tanda local actual. No ejecutar la suite destructiva en esta base.

## Verificación

Se agregaron pruebas unitarias e integración para destinatarios, aislamiento, visor, episodios, GPS y señales automáticas. Véase el informe de tarea para resultados ejecutados; no considerar validado en producción sin aplicar/verificar esquema en entorno de prueba.

## Ocultamiento individual histórico (migración 011 aplicada)

`deleted_at` marca la ocultación por destinatario. El endpoint `DELETE
/api/establecimientos/:establecimientoId/notificaciones/:id` exige sesión,
membresía no VISOR, pertenencia al usuario y establecimiento actual, y que
`read_at` ya tenga valor. La excepción es `gps_simulado_en_lote`, que se
oculta aunque no esté leída y queda marcada como leída. Devuelve 204 al ocultar;
devuelve 409 si está sin leer y 404 si no es visible para esa sesión. En el
panel, cada notificación borrable lleva una cruz. Listado, conteos y marcado masivo
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

La nueva tabla `gps_simulados` (migraci�n local 019) no invoca los disparadores descritos en esta documentaci�n: cambios de ubicaci�n, bater�a y conexi�n de esos dos GPS personales no crean notificaciones. Los endpoints anteriores y su historial permanecen intactos.

## GPS virtuales personales (alcance habilitado 26/10/2026)

La migracion 020 extiende las incidencias y la bandeja personal sin alterar migraciones anteriores. Cada episodio se identifica por establecimiento, usuario personal, UUID del GPS y tipo; las escrituras, la incidencia y el aviso se confirman en la misma transaccion. El primer GET que crea GPS no abre alertas ni reconstruye episodios historicos.

| Evento | Incidencia y aviso | Destinatario |
|---|---|---|
| Bateria baja, 11-20 % | `gps_simulado_bateria_baja` | Usuario dueno, bandeja personal |
| Bateria critica, 0-10 % | `gps_simulado_bateria_critica`; sustituye el aviso bajo cuando escala | Usuario dueno, bandeja personal |
| Sin senal manual | `gps_simulado_sin_senal` | Usuario dueno, bandeja personal |
| Fuera del establecimiento | `gps_simulado_fuera_establecimiento` | Usuario dueno, bandeja personal; ademas, solo el Administrador designado recibe un aviso operativo sin coordenadas |
| Cambio entre dos lotes activos | Aviso personal `gps_simulado_cambio_lote` (no es una incidencia de permanencia) | Usuario dueno |
| Fuera del lote asignado | `gps_simulado_fuera_lote_asignado` | Usuario dueno, bandeja personal |

La incidencia de episodio de bateria conserva que nivel ya se notifico. Un paso directo a critico manda solo el aviso critico; cambios repetidos dentro del episodio no vuelven a notificar. Se resuelve al superar 20 %. Senal, limite y lote asignado se resuelven al recuperar su condicion. La deteccion de lote solo avisa al pasar de un lote activo a otro; no notifica la posicion inicial, movimientos dentro del mismo lote, reintentos idempotentes ni cruces hacia una zona sin lote.

Los textos de los avisos personales identifican el numero y apodo del GPS y dicen "Simulacion de GPS - no es telemetria real". No incluyen coordenadas. Solo la sesion personal duena ve y marca estos avisos. La bandeja personal admite ahora estos tipos ademas de los avisos operativos anteriores. La notificacion compartida historica `gps_simulado_en_lote` y el marcador antiguo mantienen su compatibilidad; los nuevos GPS no la invocan.

La desactivacion o baja logica de un lote desasigna ese lote de los GPS en la misma transaccion y resuelve su incidencia de asignacion sin alertar. Cambiar la asignacion evalua el estado actual del GPS, pero no crea una notificacion de movimiento ni registros de pastoreo. El borde del poligono se considera interior. Al cambiar el limite del establecimiento se reevalua cada GPS; sigue rechazandose un limite que deje lotes reales afuera.
