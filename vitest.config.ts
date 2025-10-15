import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    typecheck: {
      enabled: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'src/**/__tests__/**',
        'tests_integ/',
        '*.config.*',
        'eslint.config.js',
        // REQUIRED: Exclude type-only files that contain no executable code.
        // These files have 0% coverage naturally (only type definitions, interfaces, type aliases).
        // Without these exclusions, coverage thresholds fail because v8 reports 0% for type-only files.
        'src/types/**/*.ts', // Type definition files (json.ts, messages.ts)
        'src/tools/types.ts', // Tool type definitions
        'src/tools/tool.ts', // Tool interface (no executable code)
        'src/models/model.ts', // ModelProvider interface (no executable code)
        'src/models/streaming.ts', // Streaming type definitions
        'src/index.ts', // Re-export file with no executable code
      ],
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