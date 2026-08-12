import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Les tests d'integration ouvrent de vrais ports : on evite les collisions.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
