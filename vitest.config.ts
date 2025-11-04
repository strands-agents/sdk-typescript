import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          includeSource: ['src/**/*.{js,ts}'],
          name: { label: 'source', color: 'blue' },
          typecheck: {
            enabled: true,
            include: ['src/**/*.d.ts'],
          },
        },
      },
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts'],
          name: { label: 'unit', color: 'green' },
          typecheck: {
            enabled: true,
            include: ['src/**/__tests__**/*.test-d.ts'],
          },
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
  define: {
    'import.meta.vitest': 'undefined',
  },
})
