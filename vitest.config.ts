import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
          // Tests delen één database; sequentieel draaien voorkomt onderlinge verstoring.
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
