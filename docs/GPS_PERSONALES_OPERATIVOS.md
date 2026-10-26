# GPS personales y alertas operativas

Estado actualizado 26/10/2026. Las migraciones 019, 020 y 021 están aplicadas en Neon; `db:verify` comprobó el esquema e historial hasta 021.

## Destinatarios

Las alertas GPS personales nuevas usan `notificaciones`, la bandeja operativa por puesto. Se entregan a todos los puestos Propietario activos del establecimiento y únicamente al puesto Administrador asignado a ese dispositivo si continúa activo y mantiene el permiso `ver_dispositivos_gps`. Sin asignación válida, sólo reciben los Propietarios. Otros Administradores y Visores no reciben estos avisos. El cambio de puesto responsable no recrea la misma entrega por la restricción única de incidencia y puesto; las incidencias GPS que sigan activas se entregan al puesto asignado recientemente.

El endpoint de administración es `GET /api/establecimientos/:establecimientoId/dispositivos-simulados/responsables` y `PATCH /api/establecimientos/:establecimientoId/dispositivos-simulados/:dispositivoId/responsable`, exclusivo para Propietarios. La lista incluye los GPS personales mínimos para asignación y sólo Administradores activos con permiso de lectura. La FK compuesta mantiene el GPS y el puesto en el mismo establecimiento.

## Incidencias y avisos

Los tipos operativos personales son `gps_simulado_bateria_baja`, `gps_simulado_bateria_critica`, `gps_simulado_bateria_agotada`, `gps_simulado_sin_senal`, `gps_simulado_fuera_establecimiento`, `gps_simulado_fuera_lote_asignado` y `gps_simulado_cambio_lote`. Todos identifican el número/apodo del GPS, dicen que son una simulación y omiten coordenadas.

La batería escala a crítica al 10 % y agotada al 0 %. Agotada resuelve crítica para evitar dos avisos simultáneos; cada nivel se notifica una sola vez por episodio, que se resuelve al superar 20 %. Si el GPS sale del establecimiento, se suprime la alerta redundante del lote asignado. El cambio de lote sólo se informa al cruzar entre dos lotes activos, no por posición inicial, repetición del PATCH ni movimiento dentro del lote.

La antigua tabla `notificaciones_personales` y sus avisos históricos se conservan, pero las nuevas alertas GPS no se duplican allí. El responsable GPS global anterior y el aviso histórico `gps_simulado_en_lote` siguen disponibles sólo para compatibilidad con el marcador compartido anterior; no determinan destinatarios de GPS personales.

## Verificación

No ejecutar `npm run test:integration` contra `DATABASE_URL`. Las unitarias y builds se pueden correr sin modificar Neon. Las pruebas funcionales con cuentas QA deben verificar destinatarios, revocación de permisos, lectura/borrado de la bandeja y aislamiento; el navegador debe revisar mapa, «Mis dispositivos», selector de responsable y bandejas.
