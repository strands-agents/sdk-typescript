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
          exclude: ['tests_integ/agent-browser.test.ts'],
          name: { label: 'integ', color: 'magenta' },
          testTimeout: 30000,
          retry: 1,
          globalSetup: './tests_integ/integ-setup.ts',
          sequence: {
            concurrent: true,
          },
        },
      },
      {
        test: {
          include: ['tests_integ/agent-browser.test.ts'],
          name: { label: 'integ-browser', color: 'yellow' },
          testTimeout: 30000,
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
          // Pass AWS credentials and API keys via define for browser environment
          define: {
            'import.meta.env.AWS_ACCESS_KEY_ID': JSON.stringify(process.env.AWS_ACCESS_KEY_ID || ''),
            'import.meta.env.AWS_SECRET_ACCESS_KEY': JSON.stringify(process.env.AWS_SECRET_ACCESS_KEY || ''),
            'import.meta.env.AWS_SESSION_TOKEN': JSON.stringify(process.env.AWS_SESSION_TOKEN || ''),
            'import.meta.env.AWS_REGION': JSON.stringify(process.env.AWS_REGION || 'us-east-1'),
            'import.meta.env.OPENAI_API_KEY': JSON.stringify(process.env.OPENAI_API_KEY || ''),
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
