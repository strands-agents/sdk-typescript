# Vended Tools

This directory contains optional tools that are provided as part of the Strands SDK but are not required dependencies of the core SDK.

## What are Vended Tools?

Vended tools are pre-built, production-ready tools that developers can optionally include in their agent applications. Unlike the core SDK functionality (models, agent loop, tool registry), these tools are:

- **Optional**: Not required to use the SDK
- **Self-contained**: Have minimal dependencies
- **Production-ready**: Fully tested and documented
- **Independently importable**: Can be imported individually without loading the entire SDK

## Available Tools

### HTTP Request Tool

Make HTTP/HTTPS requests to external APIs and services.

**Location**: `vendedTools/http-request/`

**Features**:

- All standard HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- Multiple authentication types (Bearer, Token, Basic, Custom, API Key)
- Environment variable support for tokens
- User consent for modifying operations
- Custom headers and request bodies

**Usage**:

```typescript
import { httpRequest } from '@strands-agents/sdk/vendedTools/http-request'

const result = await httpRequest.stream({
  toolUse: {
    name: 'httpRequest',
    toolUseId: 'req-1',
    input: {
      method: 'GET',
      url: 'https://api.example.com/data',
      auth: {
        type: 'bearer',
        envVar: 'API_TOKEN',
      },
    },
  },
  invocationState: {},
})
```

## Contributing

When adding new vended tools:

1. Create a new directory under `vendedTools/`
2. Include implementation, types, and tests
3. Add a README.md in the tool's directory
4. Update this README to list the new tool
5. Ensure 80%+ test coverage
6. Follow the existing patterns from other vended tools

## Directory Structure

```
vendedTools/
├── README.md                    # This file
└── http-request/                # HTTP request tool
    ├── __tests__/
    │   └── http-request.test.ts # Unit tests
    ├── http-request.ts          # Implementation
    ├── types.ts                 # Type definitions
    └── index.ts                 # Public exports
```
