## Motivation

The Python SDK recently implemented Plugins as a replacement for HookProvider. Given that TypeScript hasn't shipped yet, we can implement Plugins without backward compatibility concerns around HookProvider.

Plugins provide a more structured approach to extending agent functionality with a required unique name for identification, logging, and duplicate prevention. The `initAgent(agent)` method is where plugins call `agent.addHook()` to register callbacks, and `getTools()` enables auto-registering tools with the agent.

Resolves #42

## Public API Changes

`AgentConfig` now accepts `plugins: Plugin[]` instead of `hooks: HookProvider[]`:

```typescript
// Before
const agent = new Agent({
  model,
  hooks: [myHookProvider],
})

// After
const agent = new Agent({
  model,
  plugins: [myPlugin],
})
```

Creating plugins follows a class-based pattern matching the Python SDK:

```typescript
class LoggingPlugin extends Plugin {
  get name(): string {
    return 'logging-plugin'
  }

  override initAgent(agent: AgentData): void {
    agent.addHook(BeforeInvocationEvent, (event) => {
      console.log('Agent invocation started')
    })
  }
}
```

Runtime hook registration is now done via `agent.addHook()`, which returns a cleanup function:

```typescript
const agent = new Agent({ model })

const cleanup = agent.addHook(BeforeInvocationEvent, (event) => {
  console.log('Before invocation')
})
```

Plugins can provide tools via `getTools()`, which are auto-registered during plugin initialization:

```typescript
class MyToolPlugin extends Plugin {
  get name(): string {
    return 'my-tool-plugin'
  }

  override getTools(): Tool[] {
    return [myTool]
  }
}
```

The same pattern applies to multi-agent orchestrators via `MultiAgentPlugin`. `SwarmOptions` now accepts `plugins: MultiAgentPlugin[]` instead of `hooks: HookProvider[]`, and plugins register callbacks via `initMultiAgent(orchestrator)`:

```typescript
class LoggingPlugin extends MultiAgentPlugin {
  get name(): string {
    return 'logging-plugin'
  }

  override initMultiAgent(orchestrator: MultiAgentBase): void {
    orchestrator.addHook(BeforeNodeCallEvent, (event) => {
      console.log(`Node ${event.nodeId} starting`)
    })
  }
}

const swarm = new Swarm({
  nodes: [agentA, agentB],
  start: 'agentA',
  plugins: [new LoggingPlugin()],
})
```

`HookProvider` is no longer exported. `agent.hooks` and `swarm.hooks` are now private — use `agent.addHook()` / `swarm.addHook()` for runtime hook registration. `PluginRegistry` and `MultiAgentPluginRegistry` are internal. Strands-vended plugin names are prefixed with `strands:` (e.g., `strands:sliding-window-conversation-manager`).
