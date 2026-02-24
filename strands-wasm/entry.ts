/**
 * WASM component — exports strands:agent/api.
 *
 * The Agent resource is persistent: it holds a TS Agent instance across
 * multiple generate() calls, maintaining conversation history.
 *
 * Each call to readNext() awaits the next generator value, which
 * causes componentize-js to yield via wasi:io/poll, letting the
 * host drive HTTP I/O forward.
 */

/// <reference path="./generated/interfaces/strands-agent-types.d.ts" />
/// <reference path="./generated/interfaces/strands-agent-host-log.d.ts" />

import type {
  AgentConfig,
  StreamEvent,
  StreamArgs,
  RespondArgs,
  SetMessagesArgs,
  ModelConfig,
  ModelParams,
  StopData,
  ToolSpec,
} from 'strands:agent/types';

import { callTool } from 'strands:agent/tool-provider';
import { log as hostLog } from 'strands:agent/host-log';
import { Agent, FunctionTool } from '@strands-agents/sdk';
import { AnthropicModel } from '@strands-agents/sdk/anthropic';
import { BedrockModel } from '@strands-agents/sdk/bedrock';
import type { StopReason, AgentStreamEvent, Model, BaseModelConfig } from '@strands-agents/sdk';

// All log calls go through `hostLog` (the WIT import).  The host can
// route them to Python `logging`, Rust `tracing`, or whatever fits.

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

function glog(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  hostLog({ level, message, context: context ? JSON.stringify(context) : undefined });
}

/** Capture a JS Error's stack and message as a structured context blob. */
function errContext(err: unknown, extra?: Record<string, unknown>): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(String(err));
  return { error: e.message, stack: e.stack, ...extra };
}

function mapUsage(src: any): import('strands:agent/types').Usage | undefined {
  if (src == null) return undefined;
  return {
    inputTokens: src.inputTokens ?? 0,
    outputTokens: src.outputTokens ?? 0,
    totalTokens: src.totalTokens ?? ((src.inputTokens ?? 0) + (src.outputTokens ?? 0)),
    cacheReadInputTokens: src.cacheReadInputTokens ?? undefined,
    cacheWriteInputTokens: src.cacheWriteInputTokens ?? undefined,
  };
}

function mapMetrics(src: any): import('strands:agent/types').Metrics | undefined {
  if (src == null) return undefined;
  return { latencyMs: typeof src.latencyMs === 'number' ? src.latencyMs : 0 };
}

function mapStopReason(reason: StopReason, agentResult?: any): StopData {
  const mapped: StopData['reason'] = (() => {
    switch (reason) {
      case 'endTurn': return 'end-turn';
      case 'toolUse': return 'tool-use';
      case 'maxTokens': return 'max-tokens';
      case 'contentFiltered': return 'content-filtered';
      case 'guardrailIntervened': return 'guardrail-intervened';
      case 'stopSequence': return 'stop-sequence';
      case 'modelContextWindowExceeded': return 'model-context-window-exceeded';
      default: return 'error';
    }
  })();

  return { reason: mapped, usage: mapUsage(agentResult?.usage), metrics: mapMetrics(agentResult?.metrics) };
}

function mapEvent(event: AgentStreamEvent): StreamEvent | null {
  if ('interrupt' in event || ('type' in event && (event as any).type === 'interrupt')) {
    return { tag: 'interrupt', val: JSON.stringify(event) };
  }

  if (!('type' in event)) {
    glog('trace', 'mapEvent: skipping event without type', { keys: Object.keys(event) });
    return null;
  }

  const ev = event as any;

  if (ev.type === 'modelContentBlockDeltaEvent') {
    const delta = ev.delta;
    if (delta?.type === 'textDelta' && typeof delta.text === 'string') {
      return { tag: 'text-delta', val: delta.text };
    }
    return null;
  }

  if (ev.type === 'modelStreamUpdateEvent' && ev.event) {
    return mapEvent(ev.event);
  }

  if (ev.type === 'contentBlockEvent' && ev.contentBlock) {
    return mapEvent(ev.contentBlock);
  }

  if (ev.type === 'toolResultEvent' && ev.result) {
    return mapEvent(ev.result);
  }

  if (ev.type === 'toolUseBlock' || (ev.type === 'modelContentBlockStartEvent' && ev.contentBlock?.type === 'tool_use')) {
    const block = ev.type === 'toolUseBlock' ? ev : ev.contentBlock;
    if (block?.name) {
      glog('debug', 'mapEvent: tool-use', { name: block.name, toolUseId: block.id ?? block.toolUseId });
      return {
        tag: 'tool-use',
        val: {
          name: block.name,
          toolUseId: block.id ?? block.toolUseId ?? '',
          input: JSON.stringify(block.input ?? {}),
        },
      };
    }
  }

  if (ev.type === 'toolResultBlock') {
    glog('debug', 'mapEvent: tool-result', { toolUseId: ev.toolUseId, status: ev.status });
    return {
      tag: 'tool-result',
      val: {
        toolUseId: ev.toolUseId ?? '',
        status: ev.status ?? 'success',
        content: JSON.stringify(ev.content ?? []),
      },
    };
  }

  if (ev.type === 'toolStreamEvent') {
    return {
      tag: 'tool-result',
      val: {
        toolUseId: '',
        status: 'success',
        content: JSON.stringify({ data: ev.data ?? null }),
      },
    };
  }

  if (ev.type === 'modelMetadataEvent') {
    return { tag: 'metadata', val: { usage: mapUsage(ev.usage), metrics: mapMetrics(ev.metrics) } };
  }

  glog('debug', 'mapEvent: unhandled event type', { type: ev.type });
  return null;
}

function modelParamsConfig(params?: ModelParams): Record<string, unknown> {
  if (!params) return {};
  return {
    ...(params.maxTokens != null ? { maxTokens: params.maxTokens } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(params.topP != null ? { topP: params.topP } : {}),
  };
}

function createModel(config?: ModelConfig, params?: ModelParams): Model<BaseModelConfig> {
  const base = modelParamsConfig(params);

  if (!config) {
    glog('info', 'createModel: defaulting to Bedrock');
    return new BedrockModel({ ...base });
  }

  switch (config.tag) {
    case 'anthropic': {
      glog('info', 'createModel: Anthropic', { modelId: config.val.modelId });
      const extra = config.val.additionalConfig ? JSON.parse(config.val.additionalConfig) : {};
      return new AnthropicModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.apiKey ? { apiKey: config.val.apiKey } : {}),
        ...extra,
      });
    }
    case 'bedrock': {
      glog('info', 'createModel: Bedrock', { modelId: config.val.modelId, region: config.val.region });
      const extra = config.val.additionalConfig ? JSON.parse(config.val.additionalConfig) : {};
      const clientConfig: Record<string, unknown> = extra.clientConfig ?? {};
      if (config.val.accessKeyId && config.val.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: config.val.accessKeyId,
          secretAccessKey: config.val.secretAccessKey,
          ...(config.val.sessionToken ? { sessionToken: config.val.sessionToken } : {}),
        };
      }
      return new BedrockModel({
        ...base,
        ...(config.val.modelId ? { modelId: config.val.modelId } : {}),
        ...(config.val.region ? { region: config.val.region } : {}),
        clientConfig,
        ...extra,
      });
    }
    default:
      throw new Error(`Unknown model provider: ${(config as any).tag}`);
  }
}

function createTools(specs: ToolSpec[] | undefined): FunctionTool[] | undefined {
  if (!specs || specs.length === 0) return undefined;

  return specs.map(
    (spec) =>
      new FunctionTool({
        name: spec.name,
        description: spec.description,
        inputSchema: JSON.parse(spec.inputSchema),
        callback: (input: unknown, toolContext: any) => {
          const toolUseId = toolContext?.toolUse?.toolUseId ?? '';
          glog('debug', 'callTool: dispatching', { name: spec.name, toolUseId });

          let result: any;
          try {
            result = callTool({
              name: spec.name,
              input: JSON.stringify(input),
              toolUseId,
            });
          } catch (e: any) {
            glog('error', 'callTool: host threw', errContext(e, { tool: spec.name }));
            throw new Error(String(e?.message ?? e));
          }

          let parsed: any;
          if (typeof result === 'object' && result !== null && 'tag' in result) {
            if (result.tag === 'err') {
              glog('warn', 'callTool: host returned error', { tool: spec.name, error: result.val });
              throw new Error(result.val);
            }
            parsed = JSON.parse(result.val);
          } else {
            parsed = JSON.parse(result);
          }

          glog('debug', 'callTool: returned', { tool: spec.name, hasStatus: 'status' in (parsed ?? {}) });

          // Return just the content if it's a wrapped tool result.
          // The TS SDK expects content blocks, not the {status, content} wrapper.
          if (parsed && typeof parsed === 'object' && 'status' in parsed && 'content' in parsed) {
            return parsed.content;
          }
          return parsed;
        },
      }),
  );
}

function buildSystemPrompt(config: AgentConfig): any {
  if (config.systemPromptBlocks) {
    return JSON.parse(config.systemPromptBlocks);
  }
  return config.systemPrompt ?? undefined;
}

function createToolChoiceProxy(baseModel: any, toolChoice: any): any {
  return new Proxy(baseModel, {
    get(target: any, prop: string | symbol, receiver: any) {
      if (prop === 'stream') {
        return async function* (messages: any[], options: any) {
          yield* target.stream(messages, { ...options, toolChoice });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

import type { HookProvider, HookRegistry } from '@strands-agents/sdk';
import {
  AfterInvocationEvent,
  AfterModelCallEvent,
  AfterToolCallEvent,
  InitializedEvent,
  BeforeInvocationEvent,
  BeforeModelCallEvent,
  BeforeToolCallEvent,
  MessageAddedEvent,
} from '@strands-agents/sdk';

class LifecycleBridge implements HookProvider {
  queue: StreamEvent[] = [];

  registerCallbacks(registry: HookRegistry): void {
    const push = (type: string) => () => {
      this.queue.push({ tag: 'lifecycle', val: JSON.stringify({ type }) } as any);
    };
    registry.addCallback(InitializedEvent, push('agentInitializedEvent'));
    registry.addCallback(BeforeInvocationEvent, push('beforeInvocationEvent'));
    registry.addCallback(AfterInvocationEvent, push('afterInvocationEvent'));
    registry.addCallback(BeforeModelCallEvent, push('beforeModelCallEvent'));
    registry.addCallback(AfterModelCallEvent, push('afterModelCallEvent'));
    registry.addCallback(BeforeToolCallEvent, push('beforeToolCallEvent'));
    registry.addCallback(AfterToolCallEvent, push('afterToolCallEvent'));
    registry.addCallback(MessageAddedEvent, push('messageAddedEvent'));
  }

  drain(): StreamEvent[] {
    return this.queue.splice(0);
  }
}

function parseInput(input: string): any {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return input;
}

class AgentImpl {
  private agent: Agent;
  private defaultTools: FunctionTool[] | undefined;
  private lifecycleBridge: LifecycleBridge;

  constructor(config: AgentConfig) {
    glog('info', 'AgentImpl: constructing', {
      hasModel: !!config.model,
      hasTools: !!(config.tools?.length),
      toolCount: config.tools?.length ?? 0,
    });

    const model = createModel(config.model, config.modelParams);
    this.defaultTools = createTools(config.tools);
    this.lifecycleBridge = new LifecycleBridge();

    this.agent = new Agent({
      model,
      systemPrompt: buildSystemPrompt(config),
      tools: this.defaultTools,
      hooks: [this.lifecycleBridge],
      printer: false,
    });
  }

  generate(args: StreamArgs): ResponseStreamImpl {
    glog('debug', 'AgentImpl.generate', {
      inputLen: args.input.length,
      hasTools: !!(args.tools?.length),
      hasToolChoice: !!args.toolChoice,
    });

    if (args.tools) {
      const requestTools = createTools(args.tools);
      this.agent.toolRegistry.clear();
      if (requestTools) {
        this.agent.toolRegistry.addAll(requestTools);
      }
    }

    let originalModel: any;
    if (args.toolChoice) {
      const tc = JSON.parse(args.toolChoice);
      originalModel = (this.agent as any).model;
      (this.agent as any).model = createToolChoiceProxy(originalModel, tc);
    }

    return new ResponseStreamImpl(this.agent, args.input, this.lifecycleBridge, this.defaultTools, originalModel);
  }

  getMessages(): string {
    return JSON.stringify(this.agent.messages);
  }

  setMessages(args: SetMessagesArgs): void {
    const newMessages = JSON.parse(args.json);
    this.agent.messages.splice(0, this.agent.messages.length, ...newMessages);
  }
}

class ResponseStreamImpl {
  private done = false;
  private generator: AsyncGenerator<AgentStreamEvent, any, undefined>;
  private interruptResolve: ((payload: string) => void) | null = null;
  private agent: Agent;
  private bridge: LifecycleBridge;
  private defaultTools: FunctionTool[] | undefined;
  private originalModel: any;
  private eventIndex = 0;

  constructor(agent: Agent, input: string, bridge: LifecycleBridge, defaultTools?: FunctionTool[], originalModel?: any) {
    this.agent = agent;
    this.bridge = bridge;
    this.defaultTools = defaultTools;
    this.originalModel = originalModel;
    this.generator = agent.stream(parseInput(input) as any);
  }

  private restoreDefaults(): void {
    if (this.originalModel) {
      (this.agent as any).model = this.originalModel;
    }
    this.agent.toolRegistry.clear();
    if (this.defaultTools) {
      this.agent.toolRegistry.addAll(this.defaultTools);
    }
  }

  async readNext(): Promise<StreamEvent[] | undefined> {
    if (this.done) return undefined;

    try {
      const result = await this.generator.next();
      const lifecycle = this.bridge.drain();

      if (result.done) {
        this.done = true;
        this.restoreDefaults();
        const agentResult = result.value;
        if (agentResult) {
          return [...lifecycle, { tag: 'stop', val: mapStopReason(agentResult.stopReason, agentResult) }];
        }
        return lifecycle.length > 0 ? lifecycle : undefined;
      }

      this.eventIndex++;
      const mapped = mapEvent(result.value);
      if (mapped) lifecycle.push(mapped);
      return lifecycle.length > 0 ? lifecycle : [];
    } catch (err: any) {
      this.done = true;
      this.restoreDefaults();
      const lifecycle = this.bridge.drain();
      const msg = String(err?.message ?? err);
      return [...lifecycle, { tag: 'error', val: msg }];
    }
  }

  respond(args: RespondArgs): void {
    if (this.interruptResolve) {
      this.interruptResolve(args.payload);
      this.interruptResolve = null;
    }
  }

  cancel(): void {
    this.done = true;
    this.generator.return(undefined);
  }
}

export const api = {
  Agent: AgentImpl,
  ResponseStream: ResponseStreamImpl,
};
