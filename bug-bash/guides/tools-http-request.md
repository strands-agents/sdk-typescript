# Tools - HTTP Request

A vended tool for making HTTP requests. The agent can make GET, POST, PUT, and DELETE requests with custom headers and bodies. Import from `@strands-agents/sdk/vended-tools/http-request`.

Templates: [tools-http-request.ts](../templates/tools-http-request.ts)

---

## Request methods

- GET, POST, PUT, DELETE requests
- Custom headers and query params
- Request body (JSON)
- Verify response status and body are returned to the model

Watch for: Are HTTP errors (4xx, 5xx) returned to the model as tool results (not thrown as exceptions)?

## Edge cases

- Timeout or unreachable host
- Large response body

Watch for: Does the tool handle timeouts or unreachable hosts gracefully?
