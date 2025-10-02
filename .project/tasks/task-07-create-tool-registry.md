# Title: Create Tool Registry

## Description:
Create a ToolRegistry class for registering tools, getting tools, listing all registered tools, updating tools, and deleting tools. This registry will be used by agentic loop for determining what tools are avaialbe to the model to invoke, and if the model decides to invoke one of the tools, get the tool so it can be invoked.

## Work Required:
- Implement ToolRegistry class with:
  - Initialization that can take in a list of tools which will be registered
  - register_tools - register multiple tools with the ToolRegistry
  - get_tool - return a tool with the defined name
  - update_tool - update the registered tool with the defined name
  - list_tool_specs - return all registered tool specs to be used by the model
  - list_tool_names - return a list of all registered tool names
  - remove_tool - remove a tool from the registry
- Implement tool name validation and duplicate handling
- Create unit tests for all operations and edge cases
- Add integration test that demonstrates registry usage with decorated tools
- Add test to get a tool and then execute it

## Exit Criteria:
A working ToolRegistry class that provides complete functionality for Tool management, handles edge cases properly, integrates seamlessly with the tool decorator system, and passes comprehensive unit and integration tests.

## Dependencies:
- task-06-create-tool-decorator-system
