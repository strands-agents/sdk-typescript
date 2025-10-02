# Title: Create Base Model Provider Interface

## Description:
Implement a simple ModelProvider interface with configuration management and async streaming. Define the core types needed for model interaction including messages, tool specifications, and streaming responses.

## Work Required:
- Create ModelProvider interface with update_config, get_config, and async stream methods
  - Example python implementation: https://github.com/strands-agents/sdk-python/blob/main/src/strands/models/model.py
- Define Messages type for chat messages
  - Message and content blocks in python: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/content.py
- Create ToolSpec interface for tool specifications
  - Python tool spec interface: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/content.py
- Create ToolChoice interface for tool selection
  - https://github.com/strands-agents/sdk-python/blob/eef11cc890266b48a22dcc3e555880926d52ec88/src/strands/types/tools.py#L152-L161
- Define ModelConfig interface for provider configuration
  - Review the bedrock, openai, and ollama for model configs to come up with a general interface:
    - https://github.com/strands-agents/sdk-python/blob/main/src/strands/models/bedrock.py
    - https://github.com/strands-agents/sdk-python/blob/main/src/strands/models/openai.py
    - https://github.com/strands-agents/sdk-python/blob/main/src/strands/models/ollama.py
- Outline the expected streamed events to be returned from a model provider
  - Python streamed events: https://github.com/strands-agents/sdk-python/blob/main/src/strands/types/streaming.py
  - Bedrock ConverseStream streamed event spec that this follows: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ConverseStream.html#API_runtime_ConverseStream_ResponseSyntax
- Create Union type for stream method return values
- Add unit tests for the interface types and method signatures
- Add integration test that validates interface contracts and type safety

## Exit Criteria:
A working ModelProvider interface that can be implemented by concrete providers, with all necessary types defined for streaming chat interactions with tool support, validated by comprehensive unit and integration tests.

## Dependencies:
- task-01-setup-project-structure-and-core-type-system