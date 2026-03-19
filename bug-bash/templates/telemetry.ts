import { Agent, BedrockModel } from '@strands-agents/sdk'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { SimpleSpanProcessor, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'

const exporter = new InMemorySpanExporter()
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})
provider.register()

const agent = new Agent({
  model: new BedrockModel(),
  printer: false,
})

const result = await agent.invoke('What is 2 + 2?')
console.log('Stop reason:', result.stopReason)

// Check metrics on the result
if (result.metrics) {
  console.log('Total tokens:', result.metrics.accumulatedUsage.totalTokens)
}

// Check collected spans
await provider.forceFlush()
const spans = exporter.getFinishedSpans()
console.log('Spans collected:', spans.length)
console.log('Span names:', spans.map(s => s.name))

await provider.shutdown()
