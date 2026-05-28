import type { BenchmarkConfig, BenchmarkResult, ContextBenchTask } from './types.js'
import { extractTrajectory, trajectoryToFileList } from './contextbench/trajectory.js'
import { ensureRepoCloned } from './contextbench/loader.js'
import { evaluate } from './evaluator.js'

export async function runBenchmark(config: BenchmarkConfig, task: ContextBenchTask): Promise<BenchmarkResult> {
  const repoDir = ensureRepoCloned(task)
  console.log(`  Repo at: ${repoDir}`)

  const startTime = performance.now()
  const heartbeat = setInterval(() => {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(0)
    process.stdout.write(`\r  running... ${elapsed}s elapsed`)
  }, 5_000)

  try {
    const agent = config.createAgent(task)

    let timeoutId: ReturnType<typeof setTimeout>
    const result = await Promise.race([
      agent.invoke(
        `The repository is cloned at: ${repoDir}\n\nInvestigate the issue and find all relevant code locations.`
      ),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Benchmark timed out after 10 minutes')), 600_000)
      }),
    ])
    clearTimeout(timeoutId!)

    const latencyMs = performance.now() - startTime
    const trajectory = extractTrajectory(agent.messages, repoDir)
    const fileList = trajectoryToFileList(trajectory)

    const evaluation = await evaluate(task, fileList)

    const usage = result.metrics?.accumulatedUsage
    return {
      config: config.name,
      task: task.id,
      metrics: {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cycleCount: result.metrics?.cycleCount ?? 0,
        latencyMs: Math.round(latencyMs),
      },
      evaluation,
      trajectory: fileList,
    }
  } catch (err) {
    const latencyMs = performance.now() - startTime
    return {
      config: config.name,
      task: task.id,
      metrics: {
        inputTokens: 0,
        outputTokens: 0,
        cycleCount: 0,
        latencyMs: Math.round(latencyMs),
      },
      evaluation: {
        fileCoverage: 0,
        filePrecision: 0,
        symbolCoverage: 0,
        symbolPrecision: 0,
        spanCoverage: 0,
        spanPrecision: 0,
        editLocRecall: 0,
        editLocPrecision: 0,
      },
      trajectory: [],
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearInterval(heartbeat)
    process.stdout.write('\n')
  }
}
