# Architecture Decision: Tool Decorator System

**Date:** 2025-01-24  
**Status:** Proposed  
**Decision Maker:** AI Agent (Task 6.1)  
**Related Issues:** #51 (Task 6.1), #40 (Task 06)  

## Context

The Strands TypeScript SDK needs a developer-friendly way to create tools for agents. The Python SDK uses decorators with runtime introspection to automatically generate tool schemas from function signatures and docstrings. However, TypeScript has fundamental limitations:

- **Type erasure:** All TypeScript types are removed at compile time
- **No runtime JSDoc access:** Comments are not available at runtime
- **No built-in schema generation:** Unlike Python's Pydantic
- **Limited reflection:** `reflect-metadata` only provides basic type information

The goal is to provide a simple, type-safe, and idiomatic TypeScript solution that balances developer experience with maintainability.

## Decision

**We will implement a hybrid approach combining Zod-based schema definition with helper functions, with decorators as a future enhancement.**

### Primary Approach (Phase 1): Zod + Helper Function

**API Design:**
```typescript
import { z } from 'zod'
import { tool } from '@strands-agents/sdk'

// Define schema with Zod
const CalculatorInput = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
  a: z.number().describe('First number'),
  b: z.number().describe('Second number')
})

// Create tool with helper function
export const calculator = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: CalculatorInput,
  callback: (input) => {
    // input is automatically typed as z.infer<typeof CalculatorInput>
    const { operation, a, b } = input
    switch (operation) {
      case 'add': return a + b
      case 'subtract': return a - b
      case 'multiply': return a * b
      case 'divide': return a / b
    }
  }
})

// Tool can be passed to agent
const agent = new Agent({ tools: [calculator] })

// And called as a function
const result = calculator({ operation: 'add', a: 5, b: 3 })
```

**With context parameter:**
```typescript
export const calculator = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: CalculatorInput,
  context: true, // Inject ToolContext
  callback: (input, context) => {
    // context is typed as ToolContext
    console.log('Tool use ID:', context.toolUse.toolUseId)
    return input.a + input.b
  }
})
```

**With streaming:**
```typescript
export const calculator = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: CalculatorInput,
  callback: async function* (input) {
    yield 'Starting calculation...'
    await delay(100)
    yield 'Processing...'
    const result = input.a + input.b
    return result
  }
})
```

**Allowing manual JSON Schema:**
```typescript
// For users who don't want to use Zod
export const calculator = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic operations',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      a: { type: 'number' },
      b: { type: 'number' }
    },
    required: ['operation', 'a', 'b']
  },
  callback: (input: CalculatorInput) => {
    return input.a + input.b
  }
})
```

### Future Enhancement (Phase 2): Decorator Syntax

Once decorators become more stable in TypeScript ecosystem, add decorator syntax:

```typescript
import { z } from 'zod'
import { tool } from '@strands-agents/sdk'

const CalculatorInput = z.object({
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
  a: z.number().describe('First number'),
  b: z.number().describe('Second number')
})

@tool({
  description: 'Performs basic arithmetic operations',
  inputSchema: CalculatorInput
})
export function calculator(input: z.infer<typeof CalculatorInput>): number {
  const { operation, a, b } = input
  switch (operation) {
    case 'add': return a + b
    case 'subtract': return a - b
    case 'multiply': return a * b
    case 'divide': return a / b
  }
}
```

## Rationale

### Why Zod?

1. **Single source of truth:** Schema and types are derived from the same definition
2. **Runtime validation:** Catches errors before they reach the tool implementation
3. **Type safety:** TypeScript types are automatically inferred from Zod schemas
4. **Excellent DX:** Descriptive error messages and IDE autocomplete
5. **Industry standard:** Widely adopted in TypeScript ecosystem (used by tRPC, Remix, Next.js)
6. **Flexible:** Can add custom validation logic
7. **Schema descriptions:** Zod's `.describe()` method embeds descriptions in JSON Schema

### Why Helper Function (Not Decorator Initially)?

1. **No experimental features:** Avoids `experimentalDecorators` flag
2. **Stable TypeScript:** Works with current stable TypeScript
3. **Simpler implementation:** Less complexity than decorator metadata handling
4. **Better for agents:** Clearer, more explicit pattern
5. **Easier testing:** Standard function calls
6. **Lower maintenance:** No experimental API changes to track

### Why Not Build-Time Code Generation?

1. **Too complex:** Requires TypeScript Compiler API expertise
2. **Maintenance burden:** Difficult to maintain and debug
3. **Build tool integration:** Different behavior across Vite, Webpack, tsc, etc.
4. **Limited type support:** Complex types don't map well to JSON Schema
5. **Against simplicity tenet:** Adds unnecessary complexity

### Why Not Decorators Now?

1. **Experimental flag concerns:** May worry some users/teams
2. **Stage 3 vs Legacy:** Confusion between decorator versions
3. **Can add later:** Helper function API can coexist with decorators
4. **Limited benefit:** Without runtime introspection, decorators offer mainly syntax sugar

## Key Design Decisions

### 1. Schema Definition Strategy

**Decision:** Support both Zod schemas and manual JSON Schema

**Rationale:**
- Zod provides best DX (type safety, validation, descriptions)
- Manual JSON Schema for users who don't want Zod dependency
- Flexibility aligns with "extensible by design" tenet

**Implementation:**
```typescript
type InputSchema = z.ZodType<any> | JSONSchema

function tool(config: {
  inputSchema: InputSchema
  // ...
}): Tool {
  const jsonSchema = isZodSchema(config.inputSchema)
    ? zodToJsonSchema(config.inputSchema)
    : config.inputSchema
  // ...
}
```

### 2. Context Parameter Injection

**Decision:** Use explicit `context` configuration parameter

**Rationale:**
- Clear and explicit (obvious path is happy path)
- No magic naming conventions
- Type-safe

**API:**
```typescript
// No context
tool({ /* ... */, callback: (input) => { /* ... */ } })

// With context
tool({ 
  /* ... */, 
  context: true,
  callback: (input, context) => { /* ... */ } 
})
```

**Alternatives Considered:**
- ❌ Naming convention (e.g., parameter named "context") - too implicit
- ❌ Type-based detection - not possible with type erasure
- ✅ Explicit configuration - clear and type-safe

### 3. Error Handling

**Decision:** Always catch errors by default, return as error ToolResults

**Rationale:**
- Consistent with Python SDK behavior
- Agents can handle tool errors gracefully
- Prevents agent crash from tool failures

**No `raiseError` parameter for now:**
- Can add later if use case emerges
- Simpler API without it
- Users can manually propagate errors if needed

**Implementation:**
```typescript
try {
  const result = await callback(validatedInput, context)
  return wrapSuccess(result)
} catch (error) {
  return wrapError(error)
}
```

### 4. Callable Function Behavior

**Decision:** Tool helper returns a Tool instance that is also callable as a function

**Rationale:**
- Developers can test tools easily
- Tools can be used outside of agents
- Matches Python SDK behavior

**Implementation:**
```typescript
class CallableTool extends FunctionTool {
  constructor(config: ToolConfig) {
    super(config)
    
    // Make the instance callable
    return new Proxy(this, {
      apply: (target, thisArg, args) => {
        return target._callback(args[0], ...)
      }
    })
  }
}
```

### 5. API Surface

**Decision:** Export `tool` helper function from main SDK

**Rationale:**
- Simple, obvious entry point
- Works with existing FunctionTool pattern
- Can add decorator later without breaking changes

**Export:**
```typescript
// src/index.ts
export { tool } from './tools/tool-helper'
export { FunctionTool } from './tools/function-tool'
```

## Dependencies

**New Dependencies:**
- `zod` (production) - Schema definition and validation
- `zod-to-json-schema` (production) - Convert Zod to JSON Schema

**Bundle Size Impact:**
- Zod: ~15KB minified
- zod-to-json-schema: ~3KB minified
- Total: ~18KB minified

**Justification:**
- Zod is widely adopted and well-maintained
- Bundle size is reasonable for the DX benefits
- Users who avoid Zod can use manual JSON Schema
- Tree-shaking will reduce impact

## Migration Path

### From Current FunctionTool

Current code continues to work:
```typescript
// Still valid
const tool = new FunctionTool({
  name: 'calculator',
  description: 'Performs calculations',
  inputSchema: { /* ... */ },
  callback: (input, context) => { /* ... */ }
})
```

New code can use helper:
```typescript
// New way
const tool = tool({
  name: 'calculator',
  description: 'Performs calculations',
  inputSchema: CalculatorSchema,
  callback: (input, context) => { /* ... */ }
})
```

### Future Decorator Addition

When decorators are added, both patterns coexist:
```typescript
// Helper function (still supported)
const tool1 = tool({ /* ... */ })

// Decorator (new in future)
@tool({ /* ... */ })
function tool2(input) { /* ... */ }
```

## Implementation Plan

### Phase 1: Core Helper Function (Task 6.2)

1. Add `zod` and `zod-to-json-schema` dependencies
2. Create `tool()` helper function in `src/tools/tool-helper.ts`
3. Support both Zod schemas and manual JSON Schema
4. Implement context parameter injection
5. Make returned Tool instances callable
6. Add comprehensive unit tests
7. Update documentation and examples

**Acceptance Criteria:**
- `tool()` function exported from main SDK
- Accepts Zod schemas and converts to JSON Schema
- Accepts manual JSON Schema
- Context injection works with `context: true`
- Returned tools are callable as functions
- 80%+ test coverage
- TSDoc documentation complete

### Phase 2: Decorator Syntax (Future)

1. Evaluate decorator stability in TypeScript ecosystem
2. Enable `experimentalDecorators` in tsconfig.json
3. Implement `@tool()` decorator
4. Ensure decorator and helper function coexist
5. Add decorator-specific tests and documentation

## Examples

### Basic Tool

```typescript
import { z } from 'zod'
import { tool } from '@strands-agents/sdk'

const GetWeatherInput = z.object({
  location: z.string().describe('City name or zip code'),
  unit: z.enum(['celsius', 'fahrenheit']).optional()
})

export const getWeather = tool({
  name: 'get_weather',
  description: 'Gets current weather for a location',
  inputSchema: GetWeatherInput,
  callback: async (input) => {
    const response = await fetch(`/api/weather?location=${input.location}`)
    const data = await response.json()
    return `Temperature: ${data.temp}°${input.unit || 'celsius'}`
  }
})
```

### Tool with Context

```typescript
export const sendEmail = tool({
  name: 'send_email',
  description: 'Sends an email to a recipient',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string()
  }),
  context: true,
  callback: async (input, context) => {
    // Access invocation state
    const userId = context.invocationState.userId
    
    await emailService.send({
      from: userId,
      to: input.to,
      subject: input.subject,
      body: input.body
    })
    
    return `Email sent to ${input.to}`
  }
})
```

### Streaming Tool

```typescript
export const processDocument = tool({
  name: 'process_document',
  description: 'Processes a document with progress updates',
  inputSchema: z.object({
    documentId: z.string(),
    options: z.object({
      ocr: z.boolean().optional(),
      extract: z.boolean().optional()
    }).optional()
  }),
  callback: async function* (input) {
    yield 'Loading document...'
    const doc = await loadDocument(input.documentId)
    
    yield 'Analyzing...'
    const analysis = await analyze(doc)
    
    if (input.options?.ocr) {
      yield 'Running OCR...'
      await performOCR(doc)
    }
    
    yield 'Finalizing...'
    return `Document processed: ${analysis.summary}`
  }
})
```

### Tool with Manual JSON Schema

```typescript
// For users who don't want Zod
export const calculator = tool({
  name: 'calculator',
  description: 'Performs basic arithmetic',
  inputSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['add', 'subtract'] },
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' }
    },
    required: ['operation', 'a', 'b']
  },
  callback: (input: { operation: string; a: number; b: number }) => {
    return input.operation === 'add' ? input.a + input.b : input.a - input.b
  }
})
```

## Alignment with Development Tenets

### 1. Simple at any scale ✅
- Basic tools are simple: define schema, provide callback
- Zod provides single source of truth for types and schemas
- No complex build steps or experimental features

### 2. Extensible by design ✅
- Can override name, description manually
- Supports both Zod and manual JSON Schema
- Context injection is optional
- Can add decorators later without breaking changes

### 3. Composability ✅
- Works with existing FunctionTool and Tool interface
- Tools can be tested independently
- Tools work outside agents (callable as functions)

### 4. The obvious path is the happy path ✅
- Type errors guide developers to correct usage
- Zod validation provides clear error messages
- No magic naming conventions
- Explicit configuration

### 5. Accessible to humans and agents ✅
- Clear, documented API
- Industry-standard patterns (Zod)
- Comprehensive examples
- Good error messages

### 6. Embrace common standards ✅✅
- Zod is de facto standard for TypeScript validation
- JSON Schema output is standard format
- No custom DSLs or proprietary patterns

## Alternatives Considered

### Alternative 1: Experimental Decorators with Manual Schema

**Rejected because:**
- Requires experimental features
- Still requires manual schema definition
- No significant DX improvement over helper function
- Can add decorator syntax later when more stable

### Alternative 2: Plain Helper with Manual JSON Schema Only

**Rejected because:**
- Poor DX: types and schemas drift
- No runtime validation
- Verbose schema definition
- TypeScript ecosystem moving toward Zod

### Alternative 3: Build-Time Code Generation

**Rejected because:**
- Too complex to implement and maintain
- Build tool integration challenges
- Debugging difficulties
- Against "simple at any scale" tenet

### Alternative 4: Make Zod Fully Optional

**Accepted with modification:**
- We will support both Zod and manual JSON Schema
- Zod is recommended but not required
- Documentation emphasizes Zod benefits
- Examples show both approaches

## Open Questions

### 1. Should we add input validation by default?

**Answer:** Yes, when using Zod schemas. Zod validates automatically, providing runtime safety. Manual JSON Schema does not provide runtime validation (only type checking).

### 2. Should we support class methods as tools?

**Answer:** Not in initial implementation. Focus on standalone functions first. Can add class method support in future if needed.

### 3. How to handle tool versioning?

**Answer:** Out of scope for this task. Tools don't have built-in versioning yet. Can add in future if needed.

### 4. Should we support TypeScript 5.0 decorators (Stage 3)?

**Answer:** Not now. Stage 3 decorators have different capabilities and limitations. Revisit when ecosystem adoption is higher.

## Success Metrics

- **Developer satisfaction:** Positive feedback on API design
- **Type safety:** Zero type errors when using Zod schemas correctly
- **Runtime safety:** Validation catches invalid inputs
- **Adoption:** Developers choose `tool()` helper over manual FunctionTool
- **Test coverage:** 80%+ coverage on tool helper implementation
- **Documentation quality:** Clear examples and API docs

## References

- Python SDK tool decorator: https://github.com/strands-agents/sdk-python/blob/main/src/strands/tools/decorator.py
- Python context parameter PR: https://github.com/strands-agents/sdk-python/commit/606f65756668274d3acf2600b76df10745a08f1f
- Strands tool documentation: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/tools/python-tools/#python-tool-decorators
- Zod documentation: https://zod.dev/
- TypeScript Decorators: https://www.typescriptlang.org/docs/handbook/decorators.html

## Approval

This decision document is proposed by the AI agent implementing Task 6.1. It requires review and approval from the development team before proceeding with implementation in Task 6.2.

**Next Steps:**
1. Team review of this decision document
2. Feedback and iterations on approach
3. Final approval
4. Update Task 6.2 with detailed implementation requirements
5. Proceed with implementation
