import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Les tests d'integration ouvrent de vrais ports : on evite les collisions.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
