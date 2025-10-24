# Title: Implement Tool Helper Function with Zod Support

## Description:
Implement the `tool()` helper function that creates Tool instances with Zod-based schema definition and runtime validation. This provides a developer-friendly, type-safe way to create tools without requiring experimental TypeScript features.

## Architecture Decision
This implementation is based on the architecture decision documented in `.project/decisions/tool-decorator-architecture.md`. The decision chose a Zod + Helper Function approach for Phase 1, with decorator syntax as a future enhancement.

## Work Required:

### 1. Add Dependencies
- Add `zod` as a production dependency
- Add `zod-to-json-schema` as a production dependency
- Both should be installed with: `npm install zod zod-to-json-schema`

### 2. Create Tool Helper Types
Create `src/tools/tool-helper.ts` with:

**ToolConfig Interface:**
```typescript
interface ToolConfig<TInput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput> | JSONSchema
  context?: boolean
  callback: ToolCallback<TInput>
}

type ToolCallback<TInput> = 
  | ((input: TInput) => JSONValue | Promise<JSONValue>)
  | ((input: TInput, context: ToolContext) => JSONValue | Promise<JSONValue>)
  | ((input: TInput) => AsyncGenerator<JSONValue, JSONValue, never>)
  | ((input: TInput, context: ToolContext) => AsyncGenerator<JSONValue, JSONValue, never>)
```

### 3. Implement Tool Helper Function

**Signature:**
```typescript
export function tool<TInput = unknown>(
  config: ToolConfig<TInput>
): Tool & ((input: TInput) => ReturnType<ToolConfig<TInput>['callback']>)
```

**Behavior:**
- Accept both Zod schemas and manual JSON Schema for `inputSchema`
- If `inputSchema` is a Zod schema:
  - Convert to JSON Schema using `zodToJsonSchema()`
  - Validate input at runtime using `schema.parse()`
  - Catch validation errors and return as error ToolResults
- If `inputSchema` is manual JSON Schema:
  - Use it directly (no runtime validation)
- If `context: true`:
  - Inject `ToolContext` as second parameter to callback
- Create a Tool instance that:
  - Implements the Tool interface (extends FunctionTool)
  - Is callable as a function for testing/standalone use
  - Properly handles sync, async, and async generator callbacks

### 4. Schema Conversion Logic

**Zod Detection:**
```typescript
function isZodSchema(schema: unknown): schema is z.ZodType {
  return schema !== null && 
         typeof schema === 'object' && 
         '_def' in schema &&
         'parse' in schema
}
```

**JSON Schema Conversion:**
```typescript
function toJsonSchema(schema: z.ZodType<any> | JSONSchema): JSONSchema {
  if (isZodSchema(schema)) {
    return zodToJsonSchema(schema, {
      target: 'jsonSchema7',
      $refStrategy: 'none'
    })
  }
  return schema
}
```

### 5. Callable Tool Implementation

**Approach:** Use a Proxy or extend FunctionTool with callable behavior

```typescript
class CallableToolImpl extends FunctionTool {
  // Make instance callable as a function
  // When called directly: tool(input)
  // Returns the callback result directly (not wrapped in ToolResult)
}
```

### 6. Context Injection

**Implementation:**
- When `context: false` or undefined: callback receives only `input`
- When `context: true`: callback receives `input` and `ToolContext`
- TypeScript types should enforce correct callback signature based on `context` value

### 7. Error Handling

**Validation Errors:**
- Catch Zod validation errors
- Return ToolResult with `status: 'error'`
- Include validation error message in content

**Callback Errors:**
- Catch all errors thrown by callback
- Return ToolResult with `status: 'error'`
- Include error message and type in content

### 8. Unit Tests

Create `src/tools/__tests__/tool-helper.test.ts` with tests for:

**Schema Handling:**
- ✅ Accepts Zod schema and converts to JSON Schema
- ✅ Accepts manual JSON Schema
- ✅ Zod schema validation catches invalid input
- ✅ Manual JSON Schema skips validation

**Context Injection:**
- ✅ With `context: false`, callback receives only input
- ✅ With `context: true`, callback receives input and context
- ✅ Context contains toolUse and invocationState

**Callback Patterns:**
- ✅ Synchronous callback returns wrapped in ToolResult
- ✅ Promise callback awaited and wrapped in ToolResult
- ✅ Async generator yields stream events, returns ToolResult

**Callable Behavior:**
- ✅ Tool instance can be called as function
- ✅ Direct call returns callback result (not ToolResult)
- ✅ Tool.stream() returns ToolResult

**Error Handling:**
- ✅ Zod validation errors return error ToolResult
- ✅ Callback errors caught and return error ToolResult
- ✅ Error messages are descriptive

**Type Safety:**
- ✅ Input type inferred from Zod schema
- ✅ Callback parameter types match schema
- ✅ Context parameter only allowed when `context: true`

**Override Support:**
- ✅ Can override name in config
- ✅ Can override description in config
- ✅ Schema is correctly applied

### 9. Integration Tests

Create integration test that:
- Creates multiple tools using `tool()` helper
- Tests with both Zod schemas and manual JSON Schema
- Tests tools with and without context
- Tests all callback patterns (sync, async, generator)
- Validates tools work with Tool interface
- Tests callable behavior

### 10. Documentation

**TSDoc for `tool()` function:**
```typescript
/**
 * Creates a Tool instance from a configuration object with type-safe schema definition.
 * 
 * The tool helper supports both Zod schemas (recommended) and manual JSON Schema.
 * When using Zod schemas, input validation is performed at runtime, providing additional safety.
 * 
 * The returned Tool instance is also callable as a function for testing and standalone use.
 * 
 * @param config - Configuration for the tool
 * @returns A Tool instance that is also callable as a function
 * 
 * @example
 * ```typescript
 * import { z } from 'zod'
 * import { tool } from '@strands-agents/sdk'
 * 
 * // With Zod schema (recommended)
 * const calculator = tool({
 *   name: 'calculator',
 *   description: 'Performs arithmetic operations',
 *   inputSchema: z.object({
 *     operation: z.enum(['add', 'subtract']),
 *     a: z.number(),
 *     b: z.number()
 *   }),
 *   callback: (input) => {
 *     return input.operation === 'add' ? input.a + input.b : input.a - input.b
 *   }
 * })
 * 
 * // With context injection
 * const sendEmail = tool({
 *   name: 'send_email',
 *   description: 'Sends an email',
 *   inputSchema: z.object({
 *     to: z.string().email(),
 *     body: z.string()
 *   }),
 *   context: true,
 *   callback: (input, context) => {
 *     console.log('Tool use ID:', context.toolUse.toolUseId)
 *     return `Email sent to ${input.to}`
 *   }
 * })
 * ```
 */
```

### 11. Update Main Export

Update `src/index.ts` to export the tool helper:
```typescript
export { tool } from './tools/tool-helper'
export type { ToolConfig, ToolCallback } from './tools/tool-helper'
```

### 12. Update Documentation Files

**README.md:**
- Add tool helper to "Feature Overview" section
- Add code example showing `tool()` usage
- Mention Zod as recommended approach

**AGENTS.md:**
- Add section on tool helper implementation patterns
- Document the Zod vs manual JSON Schema choice
- Add examples of tool creation patterns

## Exit Criteria

### Functional Requirements
- [ ] `tool()` helper function is implemented and exported
- [ ] Accepts both Zod schemas and manual JSON Schema
- [ ] Zod schemas are converted to JSON Schema correctly
- [ ] Runtime validation works with Zod schemas
- [ ] Context injection works when `context: true`
- [ ] Tool instances are callable as functions
- [ ] All callback patterns supported (sync, async, generator)
- [ ] Error handling works correctly (validation and callback errors)
- [ ] Name and description can be overridden in config

### Quality Requirements
- [ ] 80%+ test coverage
- [ ] All unit tests pass
- [ ] Integration test passes
- [ ] TSDoc documentation complete
- [ ] No TypeScript errors
- [ ] No ESLint errors
- [ ] Code follows repository patterns (private fields with underscore, etc.)

### Documentation Requirements
- [ ] README.md updated with tool helper examples
- [ ] AGENTS.md updated with implementation patterns
- [ ] Decision document exists in `.project/decisions/`
- [ ] Code examples in documentation are tested and correct

## Dependencies
- task-05-create-tool-interface (Tool interface must exist)
- New dependencies: `zod` and `zod-to-json-schema`

## Implementation Notes

### Zod Schema Conversion
Use `zod-to-json-schema` library for conversion. Key options:
```typescript
zodToJsonSchema(schema, {
  target: 'jsonSchema7',      // Use JSON Schema Draft 7
  $refStrategy: 'none',        // Don't use $ref for definitions
})
```

### Type Safety
The tool helper should provide excellent TypeScript inference:
- Input type inferred from Zod schema: `z.infer<typeof schema>`
- Callback parameter types should match inferred input type
- Context parameter should be type-safe `ToolContext`

### Callable Implementation
Two approaches:
1. **Proxy approach:** Use Proxy to intercept function calls
2. **Class approach:** Create class that extends FunctionTool with call behavior

Both are acceptable. Choose the one that provides better type inference.

### Testing Strategy
- Unit tests: Test helper function in isolation with mocks
- Integration tests: Test with real Tool interface and FunctionTool
- Type tests: Use Vitest type tests (`*.test-d.ts`) to verify type inference

## Related Files
- `.project/decisions/tool-decorator-architecture.md` - Architecture decision document
- `src/tools/function-tool.ts` - Existing FunctionTool implementation
- `src/tools/tool.ts` - Tool interface
- `src/tools/types.ts` - Tool-related types

## Future Enhancements
- Phase 2: Add decorator syntax `@tool()` as alternative API
- Consider: Build-time Zod schema optimization
- Consider: Support for tool versioning
- Consider: Support for class method tools

## References
- Zod documentation: https://zod.dev/
- zod-to-json-schema: https://github.com/StefanTerdell/zod-to-json-schema
- Python SDK tool decorator: https://github.com/strands-agents/sdk-python/blob/main/src/strands/tools/decorator.py
- Strands documentation: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/tools/python-tools/#python-tool-decorators
