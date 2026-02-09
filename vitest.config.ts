import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import * as path from 'node:path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Conditionally exclude bash tool from coverage on Windows
// since tests are skipped on Windows (bash not available)
const coverageExclude = ['src/**/__tests__/**', 'src/**/__fixtures__/**', 'src/vended-tools/**/__tests__/**']
if (process.platform === 'win32') {
  coverageExclude.push('src/vended-tools/bash/**')
}

export default defineConfig({
  test: {
    unstubEnvs: true,
    reporters: [
      'default',
      ['junit', { outputFile: 'test/.artifacts/test-report/junit/report.xml', includeConsoleOutput: true }],
      ['json', { outputFile: 'test/.artifacts/test-report/json/report.json' }],
    ],
    projects: [
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts', 'src/vended-tools/**/__tests__/**/*.test.ts'],
          includeSource: ['src/**/*.{js,ts}'],
          name: { label: 'unit-node', color: 'green' },
          typecheck: {
            enabled: true,
            tsconfig: 'src/tsconfig.json',
            include: ['src/**/__tests__**/*.test-d.ts'],
          },
        },
      },
      {
        test: {
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: [
            'src/vended-tools/file_editor/**/*.test.ts',
            'src/vended-tools/bash/**/*.test.ts',
            'src/session/__tests__/file-session-manager.test.ts',
            'src/session/__tests__/s3-session-manager.test.ts',
            'src/telemetry/__tests__/metrics.test.ts',
            'src/telemetry/__tests__/tracer.test.ts',
          ],
          name: { label: 'unit-browser', color: 'cyan' },
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotDirectory: 'test/.artifacts/browser-screenshots/',
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
          alias: {
            '$/sdk': path.resolve(__dirname, './src'),
            '$/vended': path.resolve(__dirname, './src/vended-tools'),
          },
          include: ['test/integ/**/*.test.ts', 'test/integ/**/*.test.node.ts'],
          name: { label: 'integ-node', color: 'magenta' },
          testTimeout: 60 * 1000,
          retry: 1,
          globalSetup: './test/integ/__fixtures__/_setup-global.ts',
          setupFiles: './test/integ/__fixtures__/_setup-test.ts',
          sequence: {
            concurrent: true,
          },
        },
      },
      {
        test: {
          alias: {
            '$/sdk': path.resolve(__dirname, './src'),
            '$/vended': path.resolve(__dirname, './src/vended-tools'),
          },
          include: ['test/integ/**/*.test.ts', 'test/integ/**/*.test.browser.ts'],
          name: { label: 'integ-browser', color: 'yellow' },
          testTimeout: 60 * 1000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            screenshotDirectory: 'test/.artifacts/browser-screenshots/',
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          globalSetup: './test/integ/__fixtures__/_setup-global.ts',
          setupFiles: './test/integ/__fixtures__/_setup-test.ts',
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
      reportsDirectory: 'test/.artifacts/coverage',
      include: ['src/**/*.{ts,js}', 'src/vended-tools/**/*.{ts,js}'],
      exclude: coverageExclude,
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
    environment: 'node',
  },
  define: {
    'import.meta.vitest': 'undefined',
  },
})
