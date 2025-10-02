# Title: Implement Agentic Loop and Async Processing

## Description:
Create an async iterator agentic loop that coordinates execution between model providers and tools. The agentic loop manages the conversation flow by streaming model responses, executing tools when needed, and continuing until completion.

## Work Required:
- Implement agentic_loop fucntion as an async iterator that takes a list of messages, tool_registry, system_prompt, and model_provider
- Create a function that aggregates the stream of events from the model provider, and returns a stream of ContentBlock types to represent message responses constructed from model provider events
- Implement model provider invocation with messages, tool_specs (from tool_registry), and system_prompt
- Append message to the end of the messages array after the model is finished invoking
- Implement stop_reason detection for tool_use and automatic tool execution
- Add ToolResult handling that appends results to messages array and continues the loop
- Create streaming pattern that yields events from both model provider and tool execution
- Implement loop termination when stop_reason is not tool_use
- Add error propagation for failed operations
- The final result of the agentic loop should be an interface that includes the stop reason, and the last message
- Create unit tests for event loop scenarios including tool execution cycles and transactional message handling
- Create integration test that uses real model provider and decorated tools to test complete flow

### Relevant links:
- Python sdk docs for the Agentic loop: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/agent-loop/

## Exit Criteria:
A working agentic loop async iterator that coordinates model provider streaming and tool execution, properly constructs ContentBlocks from responses, handles tool_use cycles, streams all events back to the caller, and passes both unit and integration tests.

## Dependencies:
- task-07-create-tool-registry
- task-03-implement-aws-bedrock-model-provider
