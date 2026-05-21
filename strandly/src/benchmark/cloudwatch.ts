import type { BenchmarkSuiteResult } from './types.js'

const NAMESPACE = 'StrandsSDK/Benchmarks'

export async function emitMetrics(result: BenchmarkSuiteResult): Promise<void> {
  const { CloudWatchClient, PutMetricDataCommand } = await import('@aws-sdk/client-cloudwatch')
  const client = new CloudWatchClient({})

  const metricData = result.results
    .filter((r) => !r.error)
    .flatMap((r) => [
      {
        MetricName: 'FileCoverage',
        Value: r.evaluation.fileCoverage,
        Unit: 'None' as const,
        Dimensions: [
          { Name: 'Config', Value: r.config },
          { Name: 'Task', Value: r.task },
          { Name: 'Branch', Value: result.branch },
        ],
      },
      {
        MetricName: 'FilePrecision',
        Value: r.evaluation.filePrecision,
        Unit: 'None' as const,
        Dimensions: [
          { Name: 'Config', Value: r.config },
          { Name: 'Task', Value: r.task },
          { Name: 'Branch', Value: result.branch },
        ],
      },
      {
        MetricName: 'TokenUsage',
        Value: r.metrics.inputTokens + r.metrics.outputTokens,
        Unit: 'Count' as const,
        Dimensions: [
          { Name: 'Config', Value: r.config },
          { Name: 'Task', Value: r.task },
          { Name: 'Branch', Value: result.branch },
        ],
      },
      {
        MetricName: 'CycleCount',
        Value: r.metrics.cycleCount,
        Unit: 'Count' as const,
        Dimensions: [
          { Name: 'Config', Value: r.config },
          { Name: 'Task', Value: r.task },
          { Name: 'Branch', Value: result.branch },
        ],
      },
      {
        MetricName: 'Latency',
        Value: r.metrics.latencyMs,
        Unit: 'Milliseconds' as const,
        Dimensions: [
          { Name: 'Config', Value: r.config },
          { Name: 'Task', Value: r.task },
          { Name: 'Branch', Value: result.branch },
        ],
      },
    ])

  // CloudWatch accepts max 1000 metric data points per request
  for (let i = 0; i < metricData.length; i += 1000) {
    const batch = metricData.slice(i, i + 1000)
    await client.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: batch,
      })
    )
  }

  console.log(`Emitted ${metricData.length} metrics to CloudWatch namespace: ${NAMESPACE}`)
}
