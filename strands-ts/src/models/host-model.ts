/**
 * Host-side model provider proxy.
 *
 * Instead of making HTTP calls directly, this Model delegates inference
 * to the WASM host via the `model-provider` WIT import. The host
 * (Python) runs the actual model client and returns serialized
 * ModelStreamEvent JSON blobs.
 */

import { type BaseModelConfig, Model, type StreamOptions } from './model.js'
import type { ModelStreamEvent } from './streaming.js'
import type { Message } from '../types/messages.js'
import { logger } from '../logging/logger.js'

export interface HostModelConfig extends BaseModelConfig {
    /** Opaque provider config JSON passed through to the host. */
    hostConfig: string
}

export class HostModel extends Model<HostModelConfig> {
    private _config: HostModelConfig
    private _invoke: (args: {
        messages: string
        systemPrompt?: string
        toolSpecs?: Array<{ name: string; description: string; inputSchema: string }>
        config: string
    }) => Array<{ data: string }>

    constructor(
        config: HostModelConfig,
        invoke: (args: {
            messages: string
            systemPrompt?: string
            toolSpecs?: Array<{ name: string; description: string; inputSchema: string }>
            config: string
        }) => Array<{ data: string }>,
    ) {
        super()
        this._config = config
        this._invoke = invoke
    }

    updateConfig(modelConfig: HostModelConfig): void {
        this._config = { ...this._config, ...modelConfig }
    }

    getConfig(): HostModelConfig {
        return this._config
    }

    async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
        // Serialize messages to JSON for the WIT boundary.
        const messagesJson = JSON.stringify(
            messages.map((m) => ({ role: m.role, content: m.content })),
        )

        // Serialize system prompt.
        let systemPrompt: string | undefined
        if (options?.systemPrompt !== undefined) {
            systemPrompt =
                typeof options.systemPrompt === 'string'
                    ? options.systemPrompt
                    : JSON.stringify(options.systemPrompt)
        }

        // Serialize tool specs.
        const toolSpecs = options?.toolSpecs?.map((spec) => ({
            name: spec.name,
            description: spec.description,
            inputSchema: JSON.stringify(spec.inputSchema),
        }))

        logger.debug('HostModel: invoking host model provider')

        let events: Array<{ data: string }>
        try {
            const args: {
                messages: string
                systemPrompt?: string
                toolSpecs?: Array<{ name: string; description: string; inputSchema: string }>
                config: string
            } = {
                messages: messagesJson,
                config: this._config.hostConfig,
            }
            if (systemPrompt !== undefined) {
                args.systemPrompt = systemPrompt
            }
            if (toolSpecs !== undefined) {
                args.toolSpecs = toolSpecs
            }
            events = this._invoke(args)
        } catch (err: any) {
            logger.error('HostModel: host invoke failed', err)
            throw new Error(`Host model provider error: ${err?.message ?? err}`)
        }

        // Deserialize each event and yield as ModelStreamEvent.
        for (const event of events) {
            try {
                const parsed = JSON.parse(event.data) as ModelStreamEvent
                yield parsed
            } catch (err) {
                logger.warn('HostModel: failed to parse event', { data: event.data })
            }
        }
    }
}