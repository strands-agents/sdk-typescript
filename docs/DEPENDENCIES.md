# Dependency Guidelines - Strands TypeScript SDK

> **IMPORTANT**: When adding or modifying dependencies, you **MUST** follow the guidelines in this document. These patterns ensure proper dependency resolution for SDK consumers and avoid version conflicts.

| Category               | When to Use                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `dependencies`         | Core SDK functionality that users don't interact with directly          |
| `peerDependencies`     | Dependencies that cross API boundaries (users construct/pass instances) |
| `devDependencies`      | Build tools, testing frameworks, linters - not shipped to users         |
| `peerDependenciesMeta` | Mark peer dependencies as optional when not all users need them         |

## Peer Dependencies

Peer dependencies are packages the consuming application provides. The SDK relies on the user's installed version, ensuring both operate on the same instance and avoiding version conflicts.

**Rule**: If a dependency crosses an API boundary, it **MUST** be a peer dependency.

**Example**: `zod` is a peer dependency because users construct Zod schemas and pass them to the SDK:

```typescript
import { z } from 'zod'
import { Agent, tool } from '@strands-agents/sdk'

const calculator = tool({
  name: 'calculator',
  inputSchema: z.object({ value: z.number() }),
  callback: (input) => input.value * 2,
})

const agent = new Agent({ model, tools: [calculator] })
```

Mark peer dependencies as **optional** when not all users need them (e.g., model provider SDKs). Optional peer dependencies must also be added to `devDependencies` for SDK development and testing.
