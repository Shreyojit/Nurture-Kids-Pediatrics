import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // forks = separate Node process per file → isolated in-memory DB per file
    pool: 'forks',
    include: ['src/tests/**/*.test.ts'],
    env: {
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-secret-do-not-use-in-prod',
      FRONTEND_URL: 'http://localhost:5173',
    },
  },
});
