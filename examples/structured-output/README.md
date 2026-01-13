# Structured Output Example

This example demonstrates how to use structured output with the Strands Agents SDK to get type-safe, validated responses from language models.

## What is Structured Output?

Structured output enables you to define the expected structure of the LLM's response using Zod schemas. The agent automatically:
- Converts your schema into a tool specification
- Validates the LLM's response against the schema
- Retries with formatted error feedback if validation fails
- Provides fully typed results in TypeScript

## Running the Example

1. Install dependencies:
   ```bash
   npm install
   ```

2. Ensure AWS credentials are configured for Amazon Bedrock.

3. Run the example:
   ```bash
   npm start
   ```

## Examples Included

### Basic Usage
Extract structured data from natural language using a simple schema.

### Agent-Level Defaults
Set a default schema at the agent level to apply it to all invocations.

### Schema Override
Override the agent's default schema for specific invocations.

### Streaming
Use structured output with streaming to see real-time events.

### Optional Fields
Handle schemas with optional fields gracefully.

## Key Features Demonstrated

- **Type Safety**: Full TypeScript type inference from Zod schemas
- **Automatic Validation**: The LLM's output is validated automatically
- **Retry Logic**: Invalid outputs trigger automatic retry with error feedback
- **Flexible Configuration**: Configure schemas at agent or invocation level
- **Streaming Support**: Works seamlessly with the streaming API

## Schema Definition

```typescript
import { z } from 'zod'

const PersonSchema = z.object({
  name: z.string().describe('Full name of the person'),
  age: z.number().describe('Age of the person in years'),
  occupation: z.string().describe('Current occupation or job title'),
})

// TypeScript automatically infers the type
type PersonInfo = z.infer<typeof PersonSchema>
```

## Usage Patterns

### Invocation-Level Schema
```typescript
const result = await agent.invoke(prompt, { 
  structuredOutputSchema: PersonSchema 
})
console.log(result.structuredOutput) // Fully typed!
```

### Agent-Level Default
```typescript
const agent = new Agent({ 
  structuredOutputSchema: PersonSchema 
})
const result = await agent.invoke(prompt)
console.log(result.structuredOutput) // Uses default schema
```

## Learn More

- [Strands Documentation](https://strandsagents.com/)
- [Structured Output Guide](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/structured-output/)
- [Zod Documentation](https://zod.dev/)
