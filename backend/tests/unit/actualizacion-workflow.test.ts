import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const workflow = readFileSync(new URL('../../../.github/workflows/actualizacion.yml', import.meta.url), 'utf8');

describe('workflow de actualización', () => {
  test('falla explícitamente si faltan secretos requeridos en vez de omitir el job', () => {
    expect(workflow).toContain('if [ -z "$DATABASE_URL" ] || [ -z "$AUTH_JWT_SECRET" ]; then');
    expect(workflow).toMatch(/if \[ -z "\$DATABASE_URL" \][\s\S]*?exit 1[\s\S]*?fi/);
    expect(workflow).not.toContain('steps.configuracion.outputs.listo');
  });
});
