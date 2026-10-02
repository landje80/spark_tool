import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root-niveau (Vitest 3 negeert dit binnen een project): de integratietests delen één database;
    // sequentieel draaien voorkomt onderlinge verstoring (deadlocks/lock timeouts in resetDb).
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          exclude: ['src/**/*.integration.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          environment: 'node',
          globalSetup: ['src/test/global-setup.ts'],
          setupFiles: ['src/test/setup.ts'],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
