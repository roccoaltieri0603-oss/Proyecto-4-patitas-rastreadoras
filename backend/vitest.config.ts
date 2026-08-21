import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    // Las integraciones hacen múltiples roundtrips contra Neon remoto; 15 s
    // deja sin margen ejecuciones sanas que habitualmente rondan 12–14 s.
    testTimeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
});
