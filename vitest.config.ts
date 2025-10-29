import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts'],
          name: { label: 'unit', color: 'green' },
        },
      },
      {
        test: {
          include: ['tests_integ/**/*.test.ts'],
          name: { label: 'integ', color: 'magenta' },
          testTimeout: 30000,
        },
      },
    ],
    sequence: {
      concurrent: true,
    },
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: ['src/**/__tests__/**', 'src/**/__fixtures__/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    environment: 'node',
  },
})
