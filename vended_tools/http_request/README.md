# HTTP Request Tool

A cross-platform HTTP request tool for making HTTP requests to external APIs from Strands agents.

## Features

- **All HTTP Methods**: Supports GET, POST, PUT, DELETE, PATCH, HEAD, and OPTIONS
- **Cross-Platform**: Uses native `fetch` API - works in Node.js 20+ and all modern browsers
- **Timeout Support**: Configurable request timeout with default of 30 seconds
- **Type-Safe**: Full TypeScript support with Zod schema validation
- **Comprehensive Error Handling**: Network errors, timeouts, and HTTP errors are properly handled

## Installation

```bash
npm install @strands-agents/sdk
```

## Usage

### With an Agent

```typescript
import { Agent } from '@strands-agents/sdk'
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'

const agent = new Agent({
  tools: [httpRequest],
})

// Agent will use the tool based on your prompts
await agent.invoke('Get data from https://api.example.com/data')
```

### Direct Invocation

```typescript
import { httpRequest } from '@strands-agents/sdk/vended_tools/http_request'

// Simple GET request
const response = await httpRequest.invoke({
  method: 'GET',
  url: 'https://api.example.com/data',
})

console.log(response.status) // 200
console.log(response.body) // Response body as text
```

## API

### Input

The tool accepts an object with the following properties:

| Property  | Type                                                                     | Required | Default | Description                          |
| --------- | ------------------------------------------------------------------------ | -------- | ------- | ------------------------------------ |
| `method`  | `'GET' \| 'POST' \| 'PUT' \| 'DELETE' \| 'PATCH' \| 'HEAD' \| 'OPTIONS'` | Yes      | -       | HTTP method to use                   |
| `url`     | `string`                                                                 | Yes      | -       | URL to send the request to           |
| `headers` | `Record<string, string>`                                                 | No       | -       | Optional HTTP headers                |
| `body`    | `string`                                                                 | No       | -       | Optional request body (for POST/PUT) |
| `timeout` | `number`                                                                 | No       | 30      | Timeout in seconds                   |

### Output

Returns an object with the following properties:

| Property     | Type                     | Description                      |
| ------------ | ------------------------ | -------------------------------- |
| `status`     | `number`                 | HTTP status code                 |
| `statusText` | `string`                 | HTTP status text                 |
| `headers`    | `Record<string, string>` | Response headers as plain object |
| `body`       | `string`                 | Response body as text            |

### Error Handling

The tool throws standard JavaScript Error objects in the following cases:

- **Timeout Error**: Request exceeds the specified timeout (error message includes "Request timed out")
- **HTTP Error**: HTTP response with non-2xx status code (error message includes HTTP status code and status text)
- **Network Errors**: Connection failures, DNS resolution failures, etc.

When used within an agent, these errors are automatically converted to tool execution errors.

## Examples

### GET Request

```typescript
const response = await httpRequest.invoke({
  method: 'GET',
  url: 'https://api.example.com/users',
})
```

### POST Request with JSON Body

```typescript
const response = await httpRequest.invoke({
  method: 'POST',
  url: 'https://api.example.com/users',
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer YOUR_TOKEN',
  },
  body: JSON.stringify({ name: 'John Doe', email: 'john@example.com' }),
})
```

### PUT Request with Custom Timeout

```typescript
const response = await httpRequest.invoke({
  method: 'PUT',
  url: 'https://api.example.com/users/123',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ name: 'Jane Doe' }),
  timeout: 10, // 10 seconds
})
```

### DELETE Request

```typescript
const response = await httpRequest.invoke({
  method: 'DELETE',
  url: 'https://api.example.com/users/123',
})
```

### HEAD Request

```typescript
const response = await httpRequest.invoke({
  method: 'HEAD',
  url: 'https://api.example.com/resource',
})

console.log(response.headers) // Check headers without downloading body
```

### OPTIONS Request

```typescript
const response = await httpRequest.invoke({
  method: 'OPTIONS',
  url: 'https://api.example.com/resource',
})

console.log(response.headers.allow) // Check allowed methods
```

### Error Handling

```typescript
try {
  const response = await httpRequest.invoke({
    method: 'GET',
    url: 'https://api.example.com/protected',
  })
} catch (error) {
  if (error instanceof Error) {
    if (error.message.includes('HTTP 401')) {
      console.error('Unauthorized access')
    } else if (error.message.includes('Request timed out')) {
      console.error('Request timed out')
    } else {
      console.error('Network error:', error.message)
    }
  }
}
```

## Browser Compatibility

The tool uses the native `fetch` API which is available in:

- Node.js 20+
- All modern browsers (Chrome, Firefox, Safari, Edge)

No polyfills or additional dependencies required.

## Type Definitions

```typescript
interface HttpRequestInput {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  url: string
  headers?: Record<string, string>
  body?: string
  timeout?: number
}

interface HttpRequestOutput {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}
```

## License

Apache-2.0
