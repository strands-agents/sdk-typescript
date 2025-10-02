# Title: Create Tool Decorator System

## Description:
Implement the @tool decorator system for TypeScript using experimental decorators. Create Tool instances from decorated functions with automatic OpenAPI spec generation and streaming support.

## Work Required:
- Enable TypeScript experimental decorators in tsconfig.json
- Implement @tool decorator that creates Tool instances from decorated functions
  - Example python implementation: https://github.com/strands-agents/sdk-python/blob/main/src/strands/tools/decorator.py
  - This decorator can be applied to a typescript function, and use its name and arguemnts to invoke to define the tools name and input schema. The docstring of the function can be used to define the tools description, and to enhance the tools input schema.
  - The name, description, and schema can all be overridden in the tool decorator
- Include a `context: bool` parameter on the tool decorator to optionally include a `ToolContext` object as input to the decorated function
  - Example python pull request adding this feature: https://github.com/strands-agents/sdk-python/commit/606f65756668274d3acf2600b76df10745a08f1f#diff-0ff8f17674e6b6f00bc696efc51dffe024f214b7f91c6989ae65f12130888a1d
  - ToolContext should only include the ToolInput object for now
- Include a `raise_error: bool` parameter on the tool decorator to optionally raise the error the tool raised. This will default to false, and if it is false, then the tool will capture the error, and turn this into a ToolResult with status: error
- Implement automatic OpenAPI JSON spec generation from TypeScript function signatures with override support
- Add streaming wrapper for non-streaming decorated functions to work with Tool interface stream method
- decorated funcitons create an implemented tool instance with the Tool interface from previous task
- Add unit tests for decorator functionality, spec generation, and Tool instance creation

## Exit Criteria:
A working @tool decorator that converts TypeScript functions into Tool instances with automatic OpenAPI spec generation, proper ToolContext injection, and streaming support for both streaming and non-streaming functions.

## Dependencies:
- task-05-create-tool-interface
