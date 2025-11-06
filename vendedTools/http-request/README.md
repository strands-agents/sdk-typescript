# HTTP Request Tool

A production-ready tool for making HTTP/HTTPS requests from Strands agents.

## Features

- **All Standard HTTP Methods**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
- **Multiple Authentication Types**:
  - Bearer Token: `Authorization: Bearer <token>`
  - Token Auth: `Authorization: token <token>` (GitHub-style)
  - Basic Auth: Username/password with Base64 encoding
  - Custom Auth: Raw Authorization header value
  - API Key: `X-API-Key` header
- **Environment Variable Support**: Read tokens from environment variables
- **User Consent**: Prompts for confirmation before modifying operations (POST, PUT, DELETE, PATCH)
- **Cross-Environment**: Works in both Node.js and browser environments
- **Type Safe**: Full TypeScript support with strict typing

## Installation

This tool is included with the Strands SDK:

```bash
npm install @strands-agents/sdk
```

## Usage

### Basic GET Request

```typescript
import { httpRequest } from '@strands-agents/sdk/vendedTools/http-request'

const result = await httpRequest.stream({
  toolUse: {
    name: 'httpRequest',
    toolUseId: 'req-1',
    input: {
      method: 'GET',
      url: 'https://api.example.com/data',
    },
  },
  invocationState: {},
})
```

### POST Request with Authentication

```typescript
import { httpRequest } from '@strands-agents/sdk/vendedTools/http-request'

const result = await httpRequest.stream({
  toolUse: {
    name: 'httpRequest',
    toolUseId: 'req-2',
    input: {
      method: 'POST',
      url: 'https://api.example.com/items',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"name": "New Item"}',
      auth: {
        type: 'bearer',
        envVar: 'API_TOKEN',
      },
    },
  },
  invocationState: {},
})
```

### Using with Agent

```typescript
import { Agent } from '@strands-agents/sdk'
import { httpRequest } from '@strands-agents/sdk/vendedTools/http-request'

const agent = new Agent({
  tools: [httpRequest],
  // ... other config
})

const response = await agent.invoke('Fetch the latest data from the API')
```

## Authentication Types

### Bearer Token

```typescript
auth: {
  type: 'bearer',
  token: 'my-secret-token'
}
```

Or from environment variable:

```typescript
auth: {
  type: 'bearer',
  envVar: 'API_TOKEN'
}
```

### Token Auth (GitHub-style)

```typescript
auth: {
  type: 'token',
  token: 'ghp_token123'
}
```

### Basic Authentication

```typescript
auth: {
  type: 'basic',
  username: 'user',
  password: 'pass'
}
```

### Custom Authorization Header

```typescript
auth: {
  type: 'custom',
  value: 'CustomScheme abc123'
}
```

### API Key

```typescript
auth: {
  type: 'apiKey',
  key: 'api-key-123'
}
```

## User Consent

For security, the tool prompts for user consent before executing modifying operations (POST, PUT, DELETE, PATCH).

**In Node.js**: Uses readline for stdin prompt
**In Browser**: Uses native `confirm()` dialog

### Bypassing Consent

For automated testing or trusted environments, set the `BYPASS_TOOL_CONSENT` environment variable:

```bash
export BYPASS_TOOL_CONSENT=true
```

## Environment Detection

The tool automatically detects whether it's running in Node.js or a browser environment and adapts its behavior:

- **Environment Variables**: Available in Node.js, gracefully handled in browser
- **User Consent**: Uses readline in Node.js, confirm() in browser
- **Base64 Encoding**: Uses Buffer in Node.js, btoa() in browser

## Error Handling

The tool returns error ToolResults for:

- Network errors
- Invalid URLs
- Missing authentication credentials
- User-cancelled requests

## Response Format

Successful responses include:

```typescript
{
  status: 200,          // HTTP status code
  headers: {            // Response headers
    'content-type': 'application/json',
    // ...
  },
  body: '...'          // Response body as text
}
```

## Testing

The tool includes comprehensive tests:

- 22 unit tests with mocked fetch
- Integration tests with real HTTP requests
- 81.62% code coverage

Run tests:

```bash
npm test -- vendedTools/http-request/__tests__/http-request.test.ts
```

## API Reference

For complete API documentation, see the TypeScript definitions in:

- `types.ts` - Type definitions
- `http-request.ts` - Implementation with TSDoc comments
