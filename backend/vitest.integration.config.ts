import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    clearMocks: true,
    setupFiles: ['./tests/setup/integration-env.ts'],
    testTimeout: 30000,
    include: ['tests/integration/**/*.test.ts'],
  },
});
