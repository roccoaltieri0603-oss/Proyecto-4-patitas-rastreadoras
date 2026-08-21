# Pruebas manuales del backend con Insomnia

Configurá `backend/.env` con `DATABASE_URL` y un `AUTH_JWT_SECRET` largo. No
uses credenciales reales en los cuerpos de prueba.

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

Usá `http://localhost:3001` como base URL. Insomnia debe conservar el cookie
jar y enviar automáticamente `rodeo_session` después del registro o login.

## Secuencia mínima

1. `GET /api/health` → `200` con `status: ok` y `database: ok`.
2. `GET /api/auth/me` sin cookie → `401`.
3. `POST /api/auth/register` → `201` y cookie de sesión.

```json
{ "username": "usuario_prueba", "password": "clave-local-123" }
```

4. Repetir el registro → `409 USERNAME_TAKEN`.
5. `GET /api/auth/me` → usuario sin `password_hash` y `onboardingCompleted: false`.
6. `POST /api/auth/logout` → `204`; luego `/auth/me` vuelve a `401`.
7. `POST /api/auth/login` → `200` y nueva cookie.
8. `POST /api/establecimiento` → `201`.

```json
{
  "nombre": "Estancia de prueba",
  "polygon": {
    "type": "Feature",
    "properties": {},
    "geometry": { "type": "Polygon", "coordinates": [[[0,0],[10,0],[10,10],[0,10],[0,0]]] }
  }
}
```

9. `GET /api/establecimiento` → `200`.
10. `POST /api/lotes` con un polígono interno → `201`. El primer lote completa
    el onboarding.

```json
{
  "apodo": "Molino",
  "polygon": {
    "type": "Feature",
    "properties": {},
    "geometry": { "type": "Polygon", "coordinates": [[[1,1],[2,1],[2,2],[1,2],[1,1]]] }
  }
}
```

11. `GET /api/lotes` → sólo lotes no eliminados, ordenados por número.
12. `PATCH /api/lotes/:id` con `{ "activo": false }` → `200`.
13. `DELETE /api/lotes/:id` → `204`; el lote desaparece del listado, pero no se
    borra físicamente.
14. Crear otro lote → su número no reutiliza el eliminado.

Casos inválidos esperados: lote fuera (`400 LOT_OUTSIDE_ESTABLISHMENT`), lote
superpuesto (`400 LOT_OVERLAPS_EXISTING`), segundo establecimiento (`409`) y
editar el límite dejando afuera cualquier lote no eliminado (`400
ESTABLISHMENT_GEOMETRY_INVALID`). Los lotes inactivos también cuentan.

Para las pruebas contra Neon, usá un username identificable como
`usuario_prueba_smoke` y limpiá únicamente esos datos mediante una operación
administrativa controlada. El flujo normal siempre usa soft delete para lotes.
