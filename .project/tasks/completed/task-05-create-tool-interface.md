# Title: Create Tool Interface

## Description:
Implement the core tool interface and related types that will be used by the tool execution system and model providers. Define the streaming tool execution pattern and result types.

## Work Required:
- Define ToolUse interface for tool execution parameters
  - Python sdk example: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/tools.py#L53
  - This is the AWS ConverseStream docs for the ToolUse interface: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolUseBlock.html
  - The `input` parameter is a json object returned from the LLM
- Define a ToolResult interface to represent the result of the tool
  - Include content (list of ToolResultContent), status (ToolStatus), and toolUseId (string)
  - Python sdk example: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/tools.py#L88
  - ConverseStream api docs: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ToolResultBlock.html
- Create Tool abstract class with tool_name (string), tool_spec (OpenAPI JSON spec), description (string) attributes, and an abstract async stream method to invoke it
  - Python sdk example: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/tools.py#L208
  - The async stream method that takes ToolUse parameter to execute the tool
  - The stream of events will be of an any type, or some generic type that can be extended by the implementer (whichever you think is best)
  - The final result of the stream method will be a ToolResult object
- Ensure tool_spec uses the same shape as ToolSpec from ModelProvider interface
- Add unit tests for the tool interface and type definitions
- Add integration test that validates complete tool interface implementation and streaming patterns

## Exit Criteria:
A complete tool interface system that supports streaming execution with proper typing for tool specifications, execution parameters, and results, validated by comprehensive unit and integration tests.

## Dependencies:
- task-02-create-base-model-provider-interface
