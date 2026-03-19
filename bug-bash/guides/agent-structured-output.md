# Agent - Structured Output

Force the agent to return data matching a Zod schema. The SDK validates the output and automatically retries if the model produces something that doesn't conform.

Docs:
- [Structured Output](https://strandsagents.com/docs/user-guide/concepts/agents/structured-output/)

Templates: [agent-structured-output.ts](../templates/agent-structured-output.ts)

---

## Schema definition

- Define a Zod schema, pass it as `structuredOutputSchema` on Agent config
- Complex schemas: nested objects, arrays, enums, optional fields

## Invocation

- Verify `result.structuredOutput` matches the schema and is properly typed
- Per-invoke schema override: pass a different schema to `invoke()` options, confirm it doesn't affect the agent-level default
- Use structured output alongside other tools

Watch for: Is `result.structuredOutput` properly typed (matches the Zod schema)?

## Validation and retry

- Trigger a validation failure (ask the model something that produces output not matching the schema), confirm automatic retry
- Tool choice forcing: verify the model is forced to use the structured output tool

Watch for: Does the retry loop actually fix validation errors, or does it loop forever? What happens with very complex schemas (deeply nested, many fields)?
