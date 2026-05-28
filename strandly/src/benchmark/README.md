# strandly benchmark

Benchmarks Strands agents against [ContextBench](https://github.com/EuniAI/ContextBench) — a code investigation benchmark that measures how well an agent finds relevant code for GitHub issues.

## Quick Start

```bash
# Run the default config (control) on the default task
AWS_REGION=us-east-1 strandly benchmark --suite contextbench

# Run a specific built-in config
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --config offloader

# Run with a custom agent file
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --agent-file ./my-agent.ts

# Use a different model
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --model us.anthropic.claude-haiku-4-5-20251001-v1:0

# Fail if file coverage drops below 10%
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --min-coverage 0.1

# Save results to files
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --output results.json --output-md results.md

# Emit metrics to CloudWatch
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --cloudwatch
```

## Prerequisites

- **Node.js 20+**
- **Python 3.x** with `pyarrow`, `tree-sitter`, `tree-sitter-languages`
- **AWS credentials** configured (for Bedrock model access and optional CloudWatch)
- **`AWS_REGION`** set to a region with Bedrock access (e.g. `us-east-1`)

Install Python deps:
```bash
pip install pyarrow tree-sitter 'tree-sitter-languages; python_version < "3.12"'
```

## Options

| Flag | Description |
|------|-------------|
| `--suite <name>` | **(required)** Benchmark suite. Currently: `contextbench` |
| `--config <name>` | Run only this built-in config |
| `--agent-file <path>` | Path to a `.ts` file exporting a custom `BenchmarkConfig` |
| `--task <id>` | ContextBench task ID (default: `django__django-15987`) |
| `--model <id>` | Model ID for built-in configs (default: `us.anthropic.claude-sonnet-4-20250514-v1:0`) |
| `--min-coverage <n>` | Minimum file coverage (0-1). Exit 1 if below. |
| `--output <path>` | Write JSON results to file |
| `--output-md <path>` | Write markdown summary to file |
| `--cloudwatch` | Emit metrics to AWS CloudWatch |

## Built-in Configs

These will be updated once we have preset context management strategies.

| Name | Strategy | Description |
|------|----------|-------------|
| `control` | SlidingWindow ws=40 | SDK default, no extras |
| `offloader` | ContextOffloader | Offloads tool results >2500 tokens, keeps 1000 token preview |
| `offloader-aggressive` | ContextOffloader | Offloads >500 tokens, keeps 200 token preview |
| `summarizing` | SummarizingConversationManager | Summarizes oldest 30% of messages, proactive at 70% context |
| `sliding-proactive` | SlidingWindow + proactive | Same ws=40 but proactively compresses at 70% context usage |
| `offloader-summarizing` | Offloader + Summarizing | Combined: offload large results + summarize old messages |

## Custom Agent File

Create a `.ts` file that exports a `BenchmarkConfig`:

```typescript
import { Agent } from './strands-ts/src/agent/agent.js'
import { BedrockModel } from './strands-ts/src/models/bedrock.js'
import { bash } from './strands-ts/src/vended-tools/bash/bash.js'
import { ContextOffloader } from './strands-ts/src/vended-plugins/context-offloader/plugin.js'
import { InMemoryStorage } from './strands-ts/src/vended-plugins/context-offloader/storage.js'
import type { BenchmarkConfig } from './strandly/src/benchmark/types.js'

const config: BenchmarkConfig = {
  name: 'my-experiment',
  description: 'Testing new offloading thresholds',
  createAgent(task) {
    return new Agent({
      model: new BedrockModel({ stream: false }),
      tools: [bash],
      plugins: [new ContextOffloader({ storage: new InMemoryStorage(), maxResultTokens: 1000, previewTokens: 500 })],
      systemPrompt: task.prompt,
      printer: false,
    })
  },
}

export default config
```

Run it:
```bash
AWS_REGION=us-east-1 strandly benchmark --suite contextbench --agent-file ./my-experiment.ts
```

## Metrics

Each run produces:

| Metric | What it measures |
|--------|-----------------|
| **File Coverage** | Fraction of gold files the agent found (recall) |
| **File Precision** | Fraction of files the agent read that were relevant |
| **Symbol Coverage/Precision** | Same at function/class granularity |
| **Span Coverage/Precision** | Same at line-range granularity |
| **EditLoc Recall/Precision** | Did the agent find the exact edit locations? |
| **Input Tokens** | Total tokens consumed (cost proxy) |
| **Cycles** | Number of agent loop iterations |
| **Latency** | Wall-clock time |

## CloudWatch

Metrics go to namespace `StrandsSDK/Benchmarks` with dimensions `Config`, `Task`, `Branch`:

- `FileCoverage`
- `FilePrecision`
- `TokenUsage`
- `CycleCount`
- `Latency`

Requires AWS credentials with `cloudwatch:PutMetricData` permission.

## How It Works

1. Clones the ContextBench repo (cached at `.cache/contextbench/`)
2. Loads a task from their gold parquet files (issue + gold file/span annotations)
3. Clones the target repo at the correct commit
4. Creates a Strands agent with the selected config
5. Runs the agent — it uses `bash` to explore the repo and find relevant code
6. Extracts which files the agent read from its tool call history
7. Evaluates against ContextBench gold annotations (Python subprocess)
8. Reports results

## Runtime

~5-10 minutes per config per task. Running all 6 built-in configs takes ~50 minutes.

## Adding New Benchmark Suites

The `--suite` flag supports multiple benchmarks. To add a new one, implement the `BenchmarkSuite` interface and register it in `index.ts`:

```typescript
import type { BenchmarkSuite } from './types.js'

const myBench: BenchmarkSuite = {
  name: 'mybench',
  async run(opts) {
    // Load tasks, run agent, evaluate, return results
  },
}
```
