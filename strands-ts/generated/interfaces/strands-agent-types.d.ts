declare module 'strands:agent/types' {
  /**
   * # Variants
   * 
   * ## `"end-turn"`
   * 
   * ## `"tool-use"`
   * 
   * ## `"max-tokens"`
   * 
   * ## `"error"`
   * 
   * ## `"content-filtered"`
   * 
   * ## `"guardrail-intervened"`
   * 
   * ## `"stop-sequence"`
   * 
   * ## `"model-context-window-exceeded"`
   * 
   * ## `"cancelled"`
   */
  export type StopReason = 'end-turn' | 'tool-use' | 'max-tokens' | 'error' | 'content-filtered' | 'guardrail-intervened' | 'stop-sequence' | 'model-context-window-exceeded' | 'cancelled';
  export interface Usage {
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
    cacheReadInputTokens?: number,
    cacheWriteInputTokens?: number,
  }
  export interface Metrics {
    latencyMs: number,
  }
  export interface MetadataEvent {
    usage?: Usage,
    metrics?: Metrics,
  }
  export interface ToolUseEvent {
    name: string,
    toolUseId: string,
    input: string,
  }
  export interface ToolResultEvent {
    toolUseId: string,
    status: string,
    content: string,
  }
  export interface ToolSpec {
    name: string,
    description: string,
    inputSchema: string,
  }
  export interface StopData {
    reason: StopReason,
    usage?: Usage,
    metrics?: Metrics,
  }
  export type StreamEvent = StreamEventTextDelta | StreamEventToolUse | StreamEventToolResult | StreamEventMetadata | StreamEventStop | StreamEventError | StreamEventInterrupt;
  export interface StreamEventTextDelta {
    tag: 'text-delta',
    val: string,
  }
  export interface StreamEventToolUse {
    tag: 'tool-use',
    val: ToolUseEvent,
  }
  export interface StreamEventToolResult {
    tag: 'tool-result',
    val: ToolResultEvent,
  }
  export interface StreamEventMetadata {
    tag: 'metadata',
    val: MetadataEvent,
  }
  export interface StreamEventStop {
    tag: 'stop',
    val: StopData,
  }
  export interface StreamEventError {
    tag: 'error',
    val: string,
  }
  export interface StreamEventInterrupt {
    tag: 'interrupt',
    val: string,
  }
  export interface AnthropicConfig {
    modelId?: string,
    apiKey?: string,
  }
  export interface BedrockConfig {
    modelId: string,
    region?: string,
    accessKeyId?: string,
    secretAccessKey?: string,
    sessionToken?: string,
  }
  export type ModelConfig = ModelConfigAnthropic | ModelConfigBedrock;
  export interface ModelConfigAnthropic {
    tag: 'anthropic',
    val: AnthropicConfig,
  }
  export interface ModelConfigBedrock {
    tag: 'bedrock',
    val: BedrockConfig,
  }
  export interface ModelParams {
    maxTokens?: number,
    temperature?: number,
    topP?: number,
  }
  export interface AgentConfig {
    model?: ModelConfig,
    modelParams?: ModelParams,
    systemPrompt?: string,
    systemPromptBlocks?: string,
    tools?: Array<ToolSpec>,
    traceContext?: string,
  }
  export interface CallToolArgs {
    name: string,
    input: string,
    toolUseId: string,
  }
  export interface CallToolsArgs {
    calls: Array<CallToolArgs>,
  }
  export interface StreamArgs {
    input: string,
    tools?: Array<ToolSpec>,
    toolChoice?: string,
  }
  export interface RespondArgs {
    payload: string,
  }
  export interface SetMessagesArgs {
    json: string,
  }
}
