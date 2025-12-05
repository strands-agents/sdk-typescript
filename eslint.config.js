import eslint from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import tsdoc from 'eslint-plugin-tsdoc'

export default [
  eslint.configs.recommended,
  // Apply SDK rules to src files
  sdkRules({
    files: ['src/**/*.ts'],
    tsconfig: './src/tsconfig.json',
  }),
  // Then unit-test rules to UTs
  unitTestRules({
    files: ['src/**/__tests__/**/*.ts'],
    tsconfig: './src/tsconfig.json',
  }),
  // Apply SDK rules to vended_tool files
  sdkRules({
    files: ['vended_tools/**/*.ts'],
    tsconfig: './vended_tools/tsconfig.json',
  }),
  // Then unit-test rules to UTs
  unitTestRules({
    files: ['vended_tools/**/__tests__/**/*.ts'],
    tsconfig: './vended_tools/tsconfig.json',
  }),
  // Apply UT rules to the integ tests
  unitTestRules({
    files: ['tests_integ/**/*.ts'],
    tsconfig: './tests_integ/tsconfig.json',
  }),
  // Then stricter integ test rules
  integTestRules({
    files: ['tests_integ/**/*.ts'],
    tsconfig: './tests_integ/tsconfig.json',
  }),
]

function sdkRules(options) {
  return {
    files: options.files,
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: options.tsconfig,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      tsdoc: tsdoc,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'tsdoc/syntax': 'error',
    },
  }
}

function unitTestRules(options) {
  return {
    files: options.files,
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: options.tsconfig,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      quotes: ['error', 'single', { avoidEscape: true }],
    },
  }
}

function integTestRules(options) {
  return {
    files: options.files,
    languageOptions: {
      parserOptions: {
        project: options.tsconfig,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../src', '../src/**'],
              message:
                'Integration tests should use $/sdk/* path aliases instead of ../src. Test fixtures can import from $/sdk/*.',
            },
          ],
        },
      ],
    },
  }
}
