import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

// Conditionally exclude bash tool from coverage on Windows
// since tests are skipped on Windows (bash not available)
const coverageExclude = [
  'src/**/__tests__/**',
  'src/**/__fixtures__/**',
  'vended_tools/**/__tests__/**',
]
if (process.platform === 'win32') {
  coverageExclude.push('vended_tools/bash/**')
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts', 'vended_tools/**/__tests__/**/*.test.ts'],
          includeSource: ['src/**/*.{js,ts}'],
          name: { label: 'unit-node', color: 'green' },
          typecheck: {
            enabled: true,
            include: ['src/**/__tests__**/*.test-d.ts'],
          },
        },
      },
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts', 'vended_tools/**/__tests__/**/*.test.ts'],
          exclude: ['vended_tools/file_editor/**/*.test.ts', 'vended_tools/bash/**/*.test.ts'],
          name: { label: 'unit-browser', color: 'cyan' },
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
        },
      },
      {
        test: {
          include: ['tests_integ/**/*.test.ts'],
          name: { label: 'integ', color: 'magenta' },
          testTimeout: 30000,
          retry: 1,
          globalSetup: './tests_integ/integ-setup.ts',
          sequence: {
            concurrent: true,
          },
        },
      },
    ],
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*', 'vended_tools/**/*'],
      exclude: coverageExclude,
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
