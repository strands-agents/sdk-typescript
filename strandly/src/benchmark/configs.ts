import { Agent } from '../../../strands-ts/src/agent/agent.js'
import { BedrockModel } from '../../../strands-ts/src/models/bedrock.js'
import { bash } from '../../../strands-ts/src/vended-tools/bash/bash.js'
import { SlidingWindowConversationManager } from '../../../strands-ts/src/conversation-manager/sliding-window-conversation-manager.js'
import { SummarizingConversationManager } from '../../../strands-ts/src/conversation-manager/summarizing-conversation-manager.js'
import { ContextOffloader } from '../../../strands-ts/src/vended-plugins/context-offloader/plugin.js'
import { InMemoryStorage } from '../../../strands-ts/src/vended-plugins/context-offloader/storage.js'
import type { BenchmarkConfig, ContextBenchTask } from './types.js'

const DEFAULT_MODEL = 'us.anthropic.claude-sonnet-4-20250514-v1:0'

// TODO: Update these configs once we have preset context management strategies
export function getConfigs(modelId?: string): BenchmarkConfig[] {
  const model = modelId ?? DEFAULT_MODEL

  return [
    {
      name: 'control',
      description: `SDK default (SlidingWindow ws=40, ${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'offloader',
      description: `Context offloading (maxResult=2500, preview=1000, ${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage() })],
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'offloader-aggressive',
      description: `Aggressive offloading (maxResult=500, preview=200, ${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 500, previewTokens: 200 })],
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'summarizing',
      description: `Summarizing conversation manager (ratio=0.3, proactive, ${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          conversationManager: new SummarizingConversationManager({
            summaryRatio: 0.3,
            proactiveCompression: true,
          }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'sliding-proactive',
      description: `Sliding window (ws=40) with proactive compression (${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          conversationManager: new SlidingWindowConversationManager({
            windowSize: 40,
            proactiveCompression: true,
          }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
    {
      name: 'offloader-summarizing',
      description: `Offloading + summarizing combined (${model})`,
      createAgent(task: ContextBenchTask): Agent {
        return new Agent({
          model: new BedrockModel({ modelId: model, stream: false }),
          tools: [bash],
          plugins: [new ContextOffloader({ storage: new InMemoryStorage() })],
          conversationManager: new SummarizingConversationManager({
            summaryRatio: 0.3,
            proactiveCompression: true,
          }),
          systemPrompt: task.prompt,
          printer: false,
        })
      },
    },
  ]
}
