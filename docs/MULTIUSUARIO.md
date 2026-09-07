# Multiusuario y múltiples establecimientos

Implementación de `feature/multiusuario`. Este documento reemplaza las decisiones
históricas de un establecimiento por cuenta, ausencia de roles y onboarding global.
La migración está preparada, pero **no fue aplicada** durante este trabajo.

## Modelo y autorización

Un usuario puede pertenecer a varios establecimientos con roles distintos. La
autoridad vive en `membresias`, identificada por `(establecimiento_id, user_id)`;
no hay roles globales, lotes asignados a administradores ni organizaciones nuevas.

Cada establecimiento tiene exactamente un principal real. `principal_user_id` y
la columna generada `principal_rol = 'PROPIETARIO'` forman, junto con el ID del
establecimiento, una FK diferida hacia su membresía propietaria. La creación del
establecimiento y su primera membresía se hace en una misma transacción.
`establecimientos.user_id` conserva al creador histórico y deja de ser UNIQUE;
no se utiliza como autorización de las APIs.

El JWT sigue identificando únicamente al usuario. Cada petición privada de un
establecimiento consulta su membresía actual en PostgreSQL. Un establecimiento
inexistente o sin membresía devuelve 404; una acción no permitida devuelve 403.
Los IDs de lotes y registros se verifican dentro del establecimiento de la URL.
Un PATCH combinado exige el permiso de cada campo enviado.

### Roles

- **VISOR:** lectura de información compartida e historial. Puede cambiar sus
  propios favoritos y el estado leído de sus notificaciones.
- **ADMINISTRADOR:** lectura más los permisos concedidos explícitamente. Nunca
  modifica su propia membresía ni crea o gestiona propietarios.
- **PROPIETARIO:** acceso operativo completo y gestión de administradores y
  visores. Las seis capacidades especiales regulan solamente a otros propietarios.
- **Principal real:** una membresía PROPIETARIO señalada por el establecimiento;
  es intocable por los demás y la única autoridad para transferir la propiedad,
  otorgar/quitar `poderes_principal` y acceder a la futura eliminación.

### Los 19 permisos de administrador

| Grupo | Identificadores |
| --- | --- |
| Lotes | `crear_lotes`, `editar_lotes`, `editar_geometria_lotes`, `activar_lotes`, `eliminar_lotes` |
| Datos | `actualizar_satelite`, `actualizar_clima` |
| Usos | `registrar_usos`, `modificar_usos` |
| IA | `usar_ia` |
| Establecimiento | `renombrar_establecimiento`, `editar_limite_establecimiento` |
| Equipo | `invitar_visores`, `invitar_administradores`, `gestionar_visores`, `gestionar_administradores` |
| Especiales | `revocar_cualquier_permiso`, `otorgar_cualquier_permiso`, `crear_admin_cualquier_permiso` |

Revocar/otorgar cualquier permiso requiere `gestionar_administradores`; crear
administradores con cualquier permiso requiere `invitar_administradores`.
Sin estas extensiones, un administrador sólo concede o retira permisos que posee.
Degradar o expulsar un administrador exige poder retirar todos sus permisos;
no sirve para eludir esa restricción. Promover un visor requiere la autoridad
de gestión correspondiente y poder conceder la configuración resultante.

“Seleccionar todos los permisos” aparece encima de la lista de administrador y
agrega todos los permisos que el actor puede conceder en esa acción. Conserva
los permisos existentes que el actor no puede retirar. Conceder los 19 requiere
aceptar una advertencia explícita. No hay selector masivo para propietarios.

### Las seis capacidades de propietario

`crear_propietarios`, `eliminar_propietarios`, `modificar_propietarios`,
`protegido`, `ignorar_proteccion`, `poderes_principal`.

Un propietario normal sólo concede/retira capacidades que posee, con las
restricciones especiales de protección y poderes. Sólo el principal real o un
propietario con `poderes_principal` administra `protegido`. Los poderes delegados
son una bandera explícita; reunir las otras capacidades no los activa.
No permiten tocar al principal, transferir ni eliminar el establecimiento.
Tampoco se puede retirar indirectamente `poderes_principal` mediante una
degradación/expulsión ejecutada por alguien que no sea el principal real.

La transferencia exige otro propietario existente y la confirmación escrita
`TRANSFERIR`. Cambia la autoridad principal y vacía **todas** las capacidades del
antiguo principal en la misma transacción. Éste conserva su membresía PROPIETARIO
y acceso operativo completo; el nuevo principal puede concederle capacidades después.

## Invitaciones

Códigos de 24 bytes aleatorios (192 bits), codificados en 32 caracteres base64url.
Se guarda SHA-256, nunca el código legible; se muestra sólo al generarlo. Cada
invitación conserva establecimiento, creador, rol, permisos/capacidades, fecha de
creación, vencimiento a los 10 minutos, fecha de uso y usuario que la consumió.

Crear, consumir y gestionar membresías se serializa mediante el lock del
establecimiento. La aceptación bloquea también la invitación, verifica vencimiento
con el reloj de PostgreSQL después de esperar el lock y vuelve a comprobar la
autoridad actual del creador. Inserta membresía y marca uso en una transacción.
Una membresía duplicada responde 409 y no consume el código. Código desconocido,
vencido, usado, de otro establecimiento esperado o cuyo creador perdió autoridad:
400 `INVALID_INVITATION`. No hay email ni proveedor externo.

## API vigente

Todas las rutas de dominio usan el prefijo explícito
`E = /api/establecimientos/:establecimientoId`. No hay fallback al establecimiento
del creador ni contexto en JWT. Las antiguas rutas `/api/establecimiento`,
`/api/lotes`, `/api/ia` y `/api/notificaciones` ya no están montadas.
Auth, health y `GET /api/copernicus/estado` mantienen sus rutas globales.

| Método y ruta | Contrato |
| --- | --- |
| `GET /api/establecimientos` | `{ establecimientos: [{ id, nombre, onboardingCompleted, membresia }] }` |
| `POST /api/establecimientos` | `{ nombre, polygon }` → 201 `{ establecimiento }`; admite varios por usuario |
| `POST /api/establecimientos/unirse` | `{ codigo, establecimientoId? }` → 201 `{ establecimientoId }` |
| `GET E` | `{ establecimiento, membresia }` |
| `PATCH E` | `{ nombre?, polygon? }`, permisos por campo y validación geométrica existente |
| `DELETE E` | Sin mutación: 403 si no es principal, 409 con lotes no eliminados, 501 si no hay lotes |
| `GET E/equipo` | `{ miembros: [{ establecimientoId, userId, username, rol, principal, permisos, capacidades }] }` |
| `PATCH E/equipo/:userId` | `{ rol, permisos: [], capacidades: [] }` → 204; reemplaza configuración |
| `DELETE E/equipo/:userId` | 204; retira membresía, conserva datos compartidos |
| `POST E/invitaciones` | Configuración de miembro → 201 `{ invitacion: { id, codigo, expiresAt } }` |
| `POST E/transferir-principal` | `{ userId, confirmacion: "TRANSFERIR" }` → 204 |
| `GET E/lotes/lecturas` | `{ satelite: ResultadoLote[], clima: Record<loteId, ResultadoClimaLote> }`; sólo SELECT |
| `PATCH E/lotes/:id/usos/:usoId` | `{ fecha: "YYYY-MM-DD" }` → `{ uso }`; exige `modificar_usos` |
| `DELETE E/lotes/:id/usos/:usoId` | 204; exige `modificar_usos` |

Los contratos de lotes, favoritos, historial, estado, clima, satélite, simulación,
IA y notificaciones conservan sus cuerpos y sufijos bajo `E`. Registrar usos
exige `registrar_usos`; editar/eliminar recalcula el estado de descanso al leerlo.
Generar propuesta IA exige `usar_ia`; confirmar lotes con `origen: "ia"` exige
además `crear_lotes`. La creación manual sigue usando la misma validación espacial.
El algoritmo de IA no cambió.

## Frontend y lectura compartida

Después de autenticarse se muestra “Mis establecimientos”, con rol por campo,
crear y unirse con código. No se recuerda el último establecimiento. Las rutas
del mapa, ficha y equipo contienen el ID explícito. Cambiar de establecimiento
desmonta el contexto anterior y descarta selección, ediciones y resultados locales.
La UI refresca la membresía al recuperar foco y cada 30 segundos; el backend
consulta permisos actuales en cada acción, sin esperar ese refresco visual.

Crear otro establecimiento inicia su propio onboarding: dibujar establecimiento
y al menos un lote. El principal retoma el paso pendiente. Los miembros invitados
no quedan bloqueados por onboarding; eliminar/desactivar todos los lotes después
de completarlo no lo reinicia. La bandera antigua del usuario se conserva por
compatibilidad, pero no decide el acceso al campo.

El Visor carga clima y condición **persistidos**, sin consultas que escriban o
llamen a proveedores. Se conserva la separación Sentinel-1/Sentinel-2 y no se
recalcula ni inventa un puntaje. Si faltan estadísticas necesarias para el panel,
se indica ausencia y el historial sigue mostrando los campos disponibles.
La lectura inicial no reconstruye una tendencia/proyección transitoria que no
esté persistida. Actualizar proveedores continúa siendo una acción con permiso.

Favoritos siguen siendo personales `(user_id, lote_id)`. Búsqueda, seis órdenes,
filtro de favoritos, selección múltiple, mapa, Leaflet Draw y Turf se conservan.
Los lotes de establecimientos diferentes pueden coincidir geográficamente.
Las notificaciones siguen siendo personales: se filtran por el campo activo;
las generales sin lote se mantienen visibles para su usuario.

## Migración y validación manual pendiente

`backend/migrations/006_multiusuario.sql` agrega las dos tablas, índices, checks,
FK de principal y onboarding por establecimiento. Convierte al creador de cada
establecimiento previo en principal sin cambiar sus IDs, geometrías ni historial.
Una repetición no reincorpora creadores posteriormente expulsados.
`backend/migrations/007_invitaciones_constraints.sql` completa en invitaciones la
whitelist de permisos/capacidades y las dependencias de permisos especiales que
ya existen en membresías. El schema verifier exige las estructuras nuevas y
rechaza el UNIQUE anterior.

**No agrega `establecimientos.deleted_at`.** La eliminación final está pendiente
de definición de producto. El botón permanece deshabilitado y el backend responde
`ESTABLISHMENT_DELETION_PENDING` sin borrar ni modificar datos. Los lotes mantienen
su soft delete existente; también los inactivos deben eliminarse antes de poder
considerar eliminar un establecimiento.

Desde la raíz del repositorio, con el entorno que el responsable haya comprobado
que apunta a la rama Neon **multiusuario-test**, ejecutar manualmente:

```powershell
npm.cmd run db:migrate --workspace backend
npm.cmd run build --workspace backend
npm.cmd run db:verify --workspace backend
```

`db:migrate` usa la configuración actual del backend y ejecuta los SQL ordenados
en una transacción; no selecciona una rama Neon por su nombre. `db:verify` usa
el código compilado y realiza inspección estructural. Ninguno se ejecutó contra
la base durante este trabajo. No se cambiaron variables de entorno.

Las pruebas unitarias de autorización, routers HTTP con JWT/DB simulada,
invitaciones, transferencia, favoritos y lectura compartida no necesitan DB.
Las pruebas de integración fueron adaptadas y ampliadas para aislamiento,
aceptación concurrente de un código, transferencia y revocación; **no se ejecutaron**.
Su runner migra y limpia exclusivamente `TEST_DATABASE_URL` distinta de
`DATABASE_URL`, sin fallback. La prohibición de migrar impide ejecutarlas ahora.
Tampoco se ejecutaron los scripts smoke ni consultas reales a proveedores.

La QA temporal con API simulada verificó 40 condiciones en navegador, incluyendo
selector, cambio de campo, onboarding nuevo, Visor sin escrituras, favoritos,
controles por permiso, selectores masivos restringidos, códigos y transferencia.
Se inspeccionó el formulario de equipo a 390 px, sin overflow horizontal.
Esta comprobación no reemplaza validar migración y concurrencia en PostgreSQL.
