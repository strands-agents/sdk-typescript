# Tools

The tool system that lets agents call functions. Covers the `tool()` factory, `FunctionTool`, `ZodTool`, the tool registry, streaming from tools, and error handling.

Docs:
- [Tools Overview](https://strandsagents.com/docs/user-guide/concepts/tools/)
- [Custom Tools](https://strandsagents.com/docs/user-guide/concepts/tools/custom-tools/)

Templates: [tools.ts](../templates/tools.ts)

---

## Creating tools

- `tool()` factory: create tools with sync, async, and async-generator callbacks
- `FunctionTool`: wrap an existing function, verify `toolSpec` is correct
- `ZodTool`: define a tool with a Zod schema, confirm input validation works
- Tool with no parameters (empty schema)
- Tool with complex nested schema

Watch for: Does Zod schema validation reject bad input before the callback runs?

## Registry

- `ToolRegistry`: add, remove, get tools by name
- Register a tool with a duplicate name, see what happens

Watch for: Does duplicate tool registration produce a clear error?

## Execution and context

- `ToolContext`: access `context.agent.appState` and `context.toolUseId` inside a tool callback
- Result wrapping: return a string, an object, a media block from a tool, verify each is handled
- Tool streaming: return a generator from a tool, verify `ToolStreamEvent` events are emitted

Watch for: Is `ToolContext` fully populated? Are async generator tools properly streamed (events emitted incrementally)?

## Error handling

- Call a tool that throws, confirm the error is returned to the model gracefully (not a crash)
- Register a tool with an invalid spec (missing name, bad schema), verify `ToolValidationError`
- Return a non-serializable value from a tool (e.g., circular reference), verify `JsonValidationError`

Watch for: When a tool throws, does the model get a useful error message or just a generic failure?
