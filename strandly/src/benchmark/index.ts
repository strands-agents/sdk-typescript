import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BenchmarkConfig, BenchmarkRunOpts, BenchmarkSuite, BenchmarkSuiteResult } from './types.js'
import { getConfigs } from './configs.js'
import { loadTask, ensureDependencies } from './contextbench/loader.js'
import { runBenchmark } from './runner.js'
import { writeResults, generateMarkdown } from './reporter.js'
import { emitMetrics } from './cloudwatch.js'

const ROOT = resolve(import.meta.dirname, '../../..')

const DEFAULT_TASK = 'django__django-15987'

async function loadCustomConfig(agentFile: string): Promise<BenchmarkConfig> {
  const absPath = resolve(agentFile)
  const module = (await import(pathToFileURL(absPath).href)) as { default?: BenchmarkConfig; config?: BenchmarkConfig }
  const config = module.default ?? module.config
  if (!config || typeof config.createAgent !== 'function') {
    throw new Error(
      `Agent file must export a BenchmarkConfig (with name, description, createAgent). Got: ${Object.keys(module).join(', ')}`
    )
  }
  return config
}

const contextbench: BenchmarkSuite = {
  name: 'contextbench',
  async run(opts: BenchmarkRunOpts): Promise<BenchmarkSuiteResult> {
    ensureDependencies()

    const taskId = opts.task ?? DEFAULT_TASK
    console.log(`Loading task: ${taskId}`)
    const task = loadTask(taskId)
    console.log(`  Repo: ${task.repo}, commit: ${task.baseCommit.slice(0, 12)}`)

    const configs = getConfigs(opts.model)
    let selectedConfigs: BenchmarkConfig[]

    if (opts.agentFile) {
      const custom = await loadCustomConfig(opts.agentFile)
      console.log(`Using custom agent: ${custom.name}`)
      selectedConfigs = [custom]
    } else if (opts.config) {
      selectedConfigs = configs.filter((c) => c.name === opts.config)
    } else {
      selectedConfigs = configs
    }

    if (selectedConfigs.length === 0) {
      const available = configs.map((c) => c.name).join(', ')
      throw new Error(`Unknown config "${opts.config}". Available: ${available}`)
    }

    const results = []
    for (const config of selectedConfigs) {
      console.log(`\nRunning config: ${config.name} (${config.description})`)
      const result = await runBenchmark(config, task)
      results.push(result)

      if (result.error) {
        console.log(`  ✗ ${config.name}: ERROR — ${result.error}`)
      } else {
        console.log(
          `  ✓ ${config.name}: coverage=${(result.evaluation.fileCoverage * 100).toFixed(0)}% ` +
            `precision=${(result.evaluation.filePrecision * 100).toFixed(1)}% ` +
            `tokens=${(result.metrics.inputTokens / 1000).toFixed(0)}K ` +
            `cycles=${result.metrics.cycleCount}`
        )
      }
    }

    const gitSha = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim()

    return {
      suite: 'contextbench',
      timestamp: new Date().toISOString(),
      gitSha,
      branch,
      results,
    }
  },
}

const suites: Record<string, BenchmarkSuite> = { contextbench }

export interface BenchmarkOpts {
  suite: string
  config?: string
  agentFile?: string
  task?: string
  model?: string
  minCoverage?: number
  output?: string
  outputMd?: string
  cloudwatch?: boolean
}

export async function benchmark(opts: BenchmarkOpts): Promise<void> {
  const suite = suites[opts.suite]
  if (!suite) {
    const available = Object.keys(suites).join(', ')
    console.error(`Unknown benchmark suite: "${opts.suite}". Available: ${available}`)
    process.exit(1)
  }

  console.log(`\nRunning benchmark suite: ${suite.name}\n`)

  const result = await suite.run({ config: opts.config, agentFile: opts.agentFile, task: opts.task, model: opts.model })

  writeResults(result, { output: opts.output, outputMd: opts.outputMd })

  if (!opts.output && !opts.outputMd) {
    console.log('\n' + generateMarkdown(result))
  }

  if (opts.cloudwatch) {
    await emitMetrics(result)
  }

  const failed = result.results.filter((r) => r.error)
  if (failed.length > 0) {
    console.error(`\n${failed.length} benchmark(s) errored.`)
    process.exit(1)
  }

  if (opts.minCoverage != null) {
    const belowThreshold = result.results.filter(
      (r) => !r.error && r.evaluation.fileCoverage < opts.minCoverage!
    )
    if (belowThreshold.length > 0) {
      console.error(
        `\nFAILED: ${belowThreshold.length} config(s) below minimum coverage of ${(opts.minCoverage * 100).toFixed(0)}%:`
      )
      for (const r of belowThreshold) {
        console.error(`  ${r.config}: ${(r.evaluation.fileCoverage * 100).toFixed(1)}%`)
      }
      process.exit(1)
    }
    console.log(`\nAll configs above minimum coverage threshold (${(opts.minCoverage * 100).toFixed(0)}%)`)
  }

  process.exit(0)
}
