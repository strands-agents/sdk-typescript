# Bash Tool

A robust tool for executing bash shell commands in Node.js environments with persistent session support.

## ⚠️ Security Warning

**This tool executes arbitrary bash commands without sandboxing or restrictions.**

- Only use with trusted input
- Commands execute with the permissions of the Node.js process
- Environment variables are inherited from the parent process
- For production deployments, consider running in a sandboxed environment (containers, VMs, etc.)
- Review all commands before execution
- Never expose this tool to untrusted users without additional security measures

## Requirements

**Node.js Only**: This tool requires Node.js and uses the `child_process` module. It will not work in browser environments.

## Features

- **Persistent Sessions**: Commands execute in a persistent bash session, maintaining state (variables, working directory, etc.) across multiple invocations
- **Separate Output Streams**: Captures stdout and stderr independently
- **Configurable Timeouts**: Prevent commands from hanging indefinitely (default: 120 seconds)
- **Session Management**: Restart sessions to clear state when needed
- **Isolated Sessions**: Each agent instance gets its own isolated bash session
- **Working Directory**: Inherits the working directory from `process.cwd()`

## Installation

```typescript
import { bash } from '@strands-agents/sdk/vended_tools/bash'
```

## Usage

### With an Agent

```typescript
import { Agent } from '@strands-agents/sdk'
import { BedrockModel } from '@strands-agents/sdk'
import { bash } from '@strands-agents/sdk/vended_tools/bash'

const agent = new Agent({
  model: new BedrockModel({
    region: 'us-east-1',
  }),
  tools: [bash],
})

// The agent can now use the bash tool
await agent.invoke('List all files in the current directory')
await agent.invoke('Create a new file called notes.txt with "Hello World"')
```

### Direct Invocation

```typescript
import { bash } from '@strands-agents/sdk/vended_tools/bash'

// Execute a command
const result = await bash.invoke(
  {
    mode: 'execute',
    command: 'echo "Hello from bash"',
  },
  context
)

console.log(result.output) // "Hello from bash"
console.log(result.error) // "" (empty if no errors)
```

### Session Persistence

Variables, functions, and working directory persist across commands in the same session:

```typescript
// Set a variable
await bash.invoke({ mode: 'execute', command: 'MY_VAR="hello"' }, context)

// Use the variable in a later command
const result = await bash.invoke({ mode: 'execute', command: 'echo $MY_VAR' }, context)

console.log(result.output) // "hello"
```

### Custom Timeout

```typescript
// Execute with a 300 second timeout
const result = await bash.invoke(
  {
    mode: 'execute',
    command: 'long_running_process',
    timeout: 300, // seconds
  },
  context
)
```

### Restart Session

Clear all session state and start fresh:

```typescript
// Set a variable
await bash.invoke({ mode: 'execute', command: 'TEMP_VAR="exists"' }, context)

// Restart the session
await bash.invoke({ mode: 'restart' }, context)

// Variable is now gone
const result = await bash.invoke({ mode: 'execute', command: 'echo $TEMP_VAR' }, context)

console.log(result.output) // "" (empty - variable doesn't exist)
```

## API Reference

### Input Schema

#### Execute Mode

```typescript
interface ExecuteInput {
  mode: 'execute'
  command: string
  timeout?: number // Optional timeout in seconds (default: 120)
}
```

#### Restart Mode

```typescript
interface RestartInput {
  mode: 'restart'
}
```

### Return Value

#### Execute Mode

Returns an object with separate stdout and stderr:

```typescript
interface BashOutput {
  output: string // Standard output (stdout)
  error: string // Standard error (stderr) - empty string if no errors
}
```

#### Restart Mode

Returns a confirmation string:

```typescript
'Bash session restarted'
```

### Error Handling

The tool throws custom errors for specific failure scenarios:

- **`BashTimeoutError`**: Thrown when a command exceeds its timeout
- **`BashSessionError`**: Thrown when the bash process encounters an error

```typescript
import { BashTimeoutError, BashSessionError } from '@strands-agents/sdk/vended_tools/bash'

try {
  await bash.invoke({ mode: 'execute', command: 'sleep 1000', timeout: 1 }, context)
} catch (error) {
  if (error instanceof BashTimeoutError) {
    console.log('Command timed out')
  } else if (error instanceof BashSessionError) {
    console.log('Session error occurred')
  }
}
```

## Implementation Details

### Session Management

- Each agent instance gets its own isolated bash session
- Sessions are stored in a WeakMap keyed by agent instance
- Sessions are lazily initialized on first command execution
- Sessions automatically clean up when the agent is garbage collected

### Working Directory

- The bash process starts in the directory returned by `process.cwd()`
- You can change directories using `cd` commands
- Directory changes persist within the session
- Restart mode resets to the original `process.cwd()`

### Timeout Behavior

- Default timeout is 120 seconds
- Timeout can be configured per-command
- On timeout, the bash process is killed immediately
- A `BashTimeoutError` is thrown

### Environment Variables

- The bash process inherits environment variables from the parent Node.js process
- You can set session-specific variables using bash syntax: `VARNAME="value"`
- Variables persist within the session until explicitly unset or the session is restarted

## Examples

### File Operations

```typescript
// Create a file
await bash.invoke({ mode: 'execute', command: 'echo "content" > myfile.txt' }, context)

// Read the file
const result = await bash.invoke({ mode: 'execute', command: 'cat myfile.txt' }, context)

console.log(result.output) // "content"
```

### Command Piping

```typescript
const result = await bash.invoke(
  {
    mode: 'execute',
    command: 'ls -la | grep ".ts" | wc -l',
  },
  context
)

console.log(result.output) // Number of .ts files
```

### Error Handling

```typescript
// Command that doesn't exist
const result = await bash.invoke({ mode: 'execute', command: 'nonexistent_command' }, context)

console.log(result.error) // "bash: nonexistent_command: command not found"
```

### Multi-Step Operations

```typescript
// Create a directory
await bash.invoke({ mode: 'execute', command: 'mkdir -p temp_workspace' }, context)

// Change into it
await bash.invoke({ mode: 'execute', command: 'cd temp_workspace' }, context)

// Create files (in the new directory)
await bash.invoke({ mode: 'execute', command: 'touch file1.txt file2.txt' }, context)

// Verify
const result = await bash.invoke({ mode: 'execute', command: 'pwd && ls' }, context)

console.log(result.output) // Shows current directory and files
```

## Limitations

- **Node.js only**: Requires the `child_process` module
- **No browser support**: Cannot run in browser environments
- **Process permissions**: Commands run with the same permissions as the Node.js process
- **No sandboxing**: Commands execute without isolation or restrictions
- **Session cleanup**: Sessions persist until the agent is garbage collected or explicitly restarted

## Best Practices

1. **Always validate input**: Never pass untrusted input directly to commands
2. **Use timeouts**: Set appropriate timeouts for long-running commands
3. **Check stderr**: Always check the `error` field in the return value
4. **Handle errors**: Wrap tool invocations in try-catch blocks
5. **Sandbox in production**: Run in containers or VMs for production deployments
6. **Restart when needed**: Use restart mode to clear session state between unrelated tasks
7. **Quote arguments**: Use proper shell quoting for arguments containing spaces or special characters

## Troubleshooting

### Commands Hanging

If commands hang indefinitely:

- Check if the command is waiting for input
- Verify the command doesn't have syntax errors that cause bash to wait for more input
- Set a shorter timeout for testing

### Session State Issues

If session state isn't persisting:

- Verify you're using the same context/agent instance
- Check that you haven't restarted the session unintentionally
- Remember that each agent instance has its own isolated session

### Permission Errors

If you encounter permission errors:

- The tool runs with the same permissions as the Node.js process
- Check file/directory permissions
- Consider running the Node.js process with appropriate permissions

## Contributing

When contributing to this tool:

- Ensure 80%+ test coverage
- Add tests for new features
- Update this README with new functionality
- Follow the existing code patterns
- Test in both unit and integration test suites
