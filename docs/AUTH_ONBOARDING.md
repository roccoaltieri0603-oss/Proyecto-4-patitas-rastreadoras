# Autenticación y onboarding

## Registro

El registro pide solamente:

- nombre de usuario;
- contraseña.

Reglas:

- el nombre de usuario es único;
- la contraseña nunca se guarda en texto plano;
- el backend genera `password_hash`;
- al crear la cuenta, `onboarding_completed_at` queda en `NULL`.

Después del registro exitoso el usuario no entra todavía a la aplicación completa: se lo lleva al mapa para crear su establecimiento y al menos un lote.

## Login

El login pide:

- nombre de usuario;
- contraseña.

Si las credenciales son válidas:

- si `onboarding_completed_at IS NULL`, el usuario vuelve al onboarding;
- si `onboarding_completed_at IS NOT NULL`, entra a la aplicación normal.

El estado del onboarding no depende de `localStorage`.

## Cuándo termina el onboarding

El onboarding se completa cuando el usuario ya tiene:

1. un establecimiento válido;
2. al menos un lote válido asociado a ese establecimiento.

En ese momento el backend debe establecer:

```text
onboarding_completed_at = NOW()
```

No debe marcarse antes.

## Qué ocurre si después borra o desactiva lotes

Una vez que `onboarding_completed_at` tiene valor, no vuelve automáticamente a `NULL`.

Por ejemplo:

- usuario completa onboarding con un establecimiento y Lote 1;
- más tarde borra Lote 1 por error o decide reorganizar todos sus lotes;
- puede seguir entrando normalmente a la aplicación.

La aplicación puede mostrar estados vacíos o pedir que cree un nuevo lote, pero no debe mandarlo otra vez al login ni reiniciar el onboarding.

## Establecimiento durante onboarding

El comportamiento visual actual se conserva:

1. usuario elige dibujar establecimiento;
2. dibuja el polígono;
3. se solicita nombre obligatorio;
4. se guarda establecimiento;
5. se habilita creación de lotes.

Por ahora cada usuario puede tener un solo establecimiento.

## Primer lote

El lote mantiene el comportamiento actual:

- número automático;
- apodo opcional;
- polígono dentro del establecimiento;
- sin superposición de área con otros lotes no eliminados.

Cuando el primer lote se crea correctamente, el backend completa el onboarding.

## Sesión

La implementación concreta de sesión puede resolverse con cookie HTTP-only o con otro mecanismo seguro del backend. La decisión técnica final debe priorizar:

- no almacenar contraseña ni secretos en frontend;
- no confiar en un `user_id` enviado libremente por el cliente;
- todos los endpoints privados deben resolver el usuario desde la sesión autenticada;
- un usuario nunca debe poder leer o modificar datos de otro.

## Endpoints mínimos esperados

La primera implementación debería contemplar como mínimo:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

`GET /api/auth/me` debe devolver suficiente información para decidir la pantalla inicial, por ejemplo:

```json
{
  "user": {
    "id": "...",
    "username": "...",
    "onboardingCompleted": false
  }
}
```

No devolver `password_hash` nunca.

## Implementación actual de sesión

El backend usa JWT firmado en la cookie HttpOnly `rodeo_session`, con
`SameSite=Lax` por defecto, `Secure` en producción y duración de 7 días. Para
un frontend cross-site se configura `COOKIE_SAME_SITE=none`, opción que el
backend sólo admite en producción junto con `Secure`. El secreto se
configura con `AUTH_JWT_SECRET` y nunca se envía al frontend. El mínimo actual
de contraseña es 8 caracteres.

## Frontend actual

El estado de autenticación ya está integrado en `App` y la aplicación del mapa
vive en `RodeoApp`, evitando cambios en el orden de hooks entre login y sesión.
El onboarding visual completo ya está implementado dentro del mapa. El usuario,
`onboarding_completed_at`, establecimiento y lotes vienen del backend; no se
usa `localStorage` para esos datos.

El frontend consulta `GET /api/auth/me` antes de renderizar el mapa. Sin sesión
muestra login/registro; con onboarding pendiente muestra una pantalla temporal
de configuración; con onboarding completo muestra la aplicación actual. Login,
registro y logout usan `credentials: "include"` para conservar la cookie.

## Validaciones

## Estado implementado en el frontend

El onboarding visual se realiza dentro de la aplicación del mapa. El frontend
carga establecimiento y lotes desde sus APIs privadas antes de mostrar la
interfaz, y después del primer lote actualiza `auth/me` sin requerir F5.
El flujo no usa ni migra automáticamente el `localStorage` anterior.

Como mínimo:

- username vacío: rechazar;
- username duplicado: `409 Conflict`;
- contraseña vacía: rechazar;
- credenciales incorrectas: respuesta genérica, sin revelar si falló usuario o contraseña;
- sesión inexistente en endpoint privado: `401 Unauthorized`.

Los mínimos de longitud de username/contraseña todavía no están definidos por el equipo. No inventar reglas agresivas sin documentarlas primero.
