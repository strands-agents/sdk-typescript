# Package Import Tests

This directory contains verification tests to ensure `@strands-agents/sdk` can be imported correctly in both ESM and CommonJS module formats.

## Running the Tests

From the root of the project:

```bash
npm run test:package
```

This command builds and installs the SDK locally, then runs both ESM and CJS import tests.

## Test Structure

```
test/packages/
├── esm-module/     # ES Module import test
│   ├── esm.js      # Uses `import { ... } from '@strands-agents/sdk'`
│   └── package.json
├── cjs-module/     # CommonJS import test
│   ├── cjs.js      # Uses `require('@strands-agents/sdk')`
│   └── package.json
└── README.md
```
