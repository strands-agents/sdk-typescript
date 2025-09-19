# Project: Strands Typescript SDK

The purpose of this project is to create a Tyepscript SDK of the Strands Agents SDK. Strands SDK is an agentic sdk with the goal of making genai agent development fast and easy. The development of a TypeScript Strands SDK is a strategic rewrite focused on bringing key features from the Python Strands framework to TypeScript environments while leveraging TypeScript's unique strengths, like being able to execute as a server (Node) or in a web browser. Rather than achieving full feature parity, this implementation concentrates on core capabilities that provide the most value to developers. Below is a list of the the features that will be developed as a part of this project, along with links to relevat Strands documentation.

- Model providers: An interface for calling LLM's which support tool-use. As a part of this project, we will implement Bedrock and OpenAI Model Providers to ship with the SDK, as well as support for custom model providers.
  - Bedrock Model Provider: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/amazon-bedrock/
  - OpenAI Model Provider: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/openai/
  - Custom Model Provider: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/custom_model_provider/
- Tool execution, Tool registry, and Tool decorators: A tool is used by an agent to interact with its environment. A tool registry is the list of tools available to an agent. A tool decorator is a feature of the sdk that allows for the easy definition of tools through code.
  - Tool: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/tools/tools_overview/
  - Tool decorator: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/tools/python-tools/#python-tool-decorators
- Async iterator event loop: This is the main driver of an agent. This coordinates the execution of an LLM, reading the stop reason, and if the stop reason is "tool_use", invoking the specified tool(s).
  - Event Loop (Agent Loop): https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/agent-loop/
- Agent interface with basic `invoke` and `stream` method implementation: The main entrypoints to invoke an agent.
  - `invoke` examples as part of the quick start guide: https://strandsagents.com/latest/documentation/docs/user-guide/quickstart/
  - `stream` examples: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/streaming/async-iterators/
- Conversation manager: Handles when the underlying Model Provider cannot handle the amount of text given, and throws a context window overflow error
  - Conversation Manager: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/conversation-management/
- Hooks: Extensibilty mechanism that allows for the execution of code at key lifecycle events of the agents invocation
  - Hooks and lifecycle events: https://strandsagents.com/latest/documentation/docs/user-guide/concepts/agents/hooks/
- Telemetry: Observability into the execution of an agent utilizing open source frameworks like OTEL
  - Observability: https://strandsagents.com/latest/documentation/docs/user-guide/observability-evaluation/observability/
  - Traces: https://strandsagents.com/latest/documentation/docs/user-guide/observability-evaluation/traces/
- Agent usage metrics: The token usage of the underlying model proivder, as well as other usage information
  - Metrics: https://strandsagents.com/latest/documentation/docs/user-guide/observability-evaluation/metrics/