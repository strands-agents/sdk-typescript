import type {
  ModelStreamEvent,
  ModelContentBlockDeltaEventData,
  ModelContentBlockStartEventData,
} from '../models/streaming.js'
import type { ToolResultBlock } from '../types/messages.js'
import type { Plugin } from '../plugins/plugin.js'
import type { LocalAgent } from '../types/agent.js'
import { ModelStreamUpdateEvent, ToolResultEvent } from '../hooks/events.js'

/**
 * Creates a default appender function for the current environment.
 * Uses process.stdout.write in Node.js and console.log in browsers.
 * @returns Appender function that writes text to the output destination
 */
export function getDefaultAppender(): (text: string) => void {
  // Check if we're in Node.js environment with stdout
  if (typeof process !== 'undefined' && process.stdout?.write) {
    return (text: string) => process.stdout.write(text)
  }
  // Fall back to console.log for browser environment
  return (text: string) => console.log(text)
}

/**
 * Plugin for printing agent activity to a destination.
 * Outputs text, reasoning, and tool execution activity to the configured appender.
 *
 * As a Plugin, it registers callbacks for:
 * - ModelStreamUpdateEvent: Handles streaming text and reasoning output
 * - ToolResultEvent: Handles tool completion status output
 */
export class AgentPrinter implements Plugin {
  readonly name = 'strands:printer'
  private readonly _appender: (text: string) => void
  private _inReasoningBlock: boolean = false
  private _toolCount: number = 0
  private _needReasoningIndent: boolean = false

  /**
   * Creates a new AgentPrinter.
   * @param appender - Function that writes text to the output destination
   */
  constructor(appender: (text: string) => void) {
    this._appender = appender
  }

  /**
   * Initialize the printer plugin by registering event callbacks.
   * Called automatically when the agent initializes.
   * @param agent - The agent to register callbacks with
   */
  public initAgent(agent: LocalAgent): void {
    // Register callback for model stream events (text and reasoning)
    agent.addHook(ModelStreamUpdateEvent, (event: ModelStreamUpdateEvent) => {
      this.handleModelStreamEvent(event.event)
    })

    // Register callback for tool result events
    agent.addHook(ToolResultEvent, (event: ToolResultEvent) => {
      this.handleToolResult(event.result)
    })
  }

  /**
   * Write content to the output destination.
   * @param content - The content to write
   */
  public write(content: string): void {
    this._appender(content)
  }

  /**
   * Handle raw model stream events unwrapped from ModelStreamUpdateEvent.
   */
  private handleModelStreamEvent(event: ModelStreamEvent): void {
    switch (event.type) {
      case 'modelContentBlockDeltaEvent':
        this.handleContentBlockDelta(event)
        break
      case 'modelContentBlockStartEvent':
        this.handleContentBlockStart(event)
        break
      case 'modelContentBlockStopEvent':
        this.handleContentBlockStop()
        break
      default:
        break
    }
  }

  /**
   * Handle content block delta events (text or reasoning).
   */
  private handleContentBlockDelta(event: ModelContentBlockDeltaEventData): void {
    const { delta } = event

    if (delta.type === 'textDelta') {
      // Output text immediately
      if (delta.text && delta.text.length > 0) {
        this.write(delta.text)
      }
    } else if (delta.type === 'reasoningContentDelta') {
      // Start reasoning block if not already in one
      if (!this._inReasoningBlock) {
        this._inReasoningBlock = true
        this._needReasoningIndent = true
        this.write('\n💭 Reasoning:\n')
      }

      // Stream reasoning text with proper indentation
      if (delta.text && delta.text.length > 0) {
        this.writeReasoningText(delta.text)
      }
    }
    // Ignore toolUseInputDelta and other delta types
  }

  /**
   * Write reasoning text with proper indentation after newlines.
   */
  private writeReasoningText(text: string): void {
    let output = ''

    for (let i = 0; i < text.length; i++) {
      const char = text[i]

      // Add indentation if needed (at start or after newline)
      if (this._needReasoningIndent && char !== '\n') {
        output += '   '
        this._needReasoningIndent = false
      }

      output += char

      // Mark that we need indentation after a newline
      if (char === '\n') {
        this._needReasoningIndent = true
      }
    }

    this.write(output)
  }

  /**
   * Handle content block start events.
   * Detects tool use starts.
   */
  private handleContentBlockStart(event: ModelContentBlockStartEventData): void {
    if (event.start?.type === 'toolUseStart') {
      // Tool execution starting
      this._toolCount++
      this.write(`\n🔧 Tool #${this._toolCount}: ${event.start.name}\n`)
    }
    // Don't assume reasoning blocks on contentBlockStart - wait for reasoningContentDelta
  }

  /**
   * Handle content block stop events.
   * Closes reasoning blocks if we were in one.
   */
  private handleContentBlockStop(): void {
    if (this._inReasoningBlock) {
      // End reasoning block with a newline if we didn't just write one
      if (!this._needReasoningIndent) {
        this.write('\n')
      }
      this._inReasoningBlock = false
      this._needReasoningIndent = false
    }
  }

  /**
   * Handle tool result events.
   * Outputs completion status.
   */
  private handleToolResult(result: ToolResultBlock): void {
    if (result.status === 'success') {
      this.write('✓ Tool completed\n')
    } else if (result.status === 'error') {
      this.write('✗ Tool failed\n')
    }
  }
}
