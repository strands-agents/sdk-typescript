import { writeFileSync } from 'node:fs'
import type { BenchmarkSuiteResult } from './types.js'

export function generateMarkdown(result: BenchmarkSuiteResult): string {
  const passed = result.results.filter((r) => !r.error)
  const failed = result.results.filter((r) => r.error)

  let md = `## Benchmark Results: ${result.suite}\n\n`
  md += `**${passed.length}/${result.results.length}** configs completed`
  if (failed.length > 0) md += ` | ${failed.length} errored`
  md += `\n\n`

  for (const r of passed) {
    const tokens = formatTokens(r.metrics.inputTokens + r.metrics.outputTokens)
    const coverage = (r.evaluation.fileCoverage * 100).toFixed(0)
    const precision = (r.evaluation.filePrecision * 100).toFixed(1)

    md += `<details>\n`
    md += `<summary><b>${r.config}</b>: File Coverage ${coverage}% | Precision ${precision}% | ${tokens} tokens | ${r.metrics.cycleCount} cycles</summary>\n\n`
    md += `| Metric | Coverage | Precision |\n`
    md += `|--------|----------|----------|\n`
    md += `| File | ${r.evaluation.fileCoverage.toFixed(3)} | ${r.evaluation.filePrecision.toFixed(3)} |\n`
    md += `| Symbol | ${r.evaluation.symbolCoverage.toFixed(3)} | ${r.evaluation.symbolPrecision.toFixed(3)} |\n`
    md += `| Span | ${r.evaluation.spanCoverage.toFixed(3)} | ${r.evaluation.spanPrecision.toFixed(3)} |\n`
    md += `| EditLoc | ${r.evaluation.editLocRecall.toFixed(3)} (recall) | ${r.evaluation.editLocPrecision.toFixed(3)} |\n\n`
    md += `**Metrics:** ${r.metrics.inputTokens.toLocaleString()} input tokens, ${r.metrics.outputTokens.toLocaleString()} output tokens, ${(r.metrics.latencyMs / 1000).toFixed(1)}s\n\n`
    md += `**Files read:** ${r.trajectory.length}\n\n`
    md += `</details>\n\n`
  }

  if (failed.length > 0) {
    md += `<details>\n<summary>Errors (${failed.length})</summary>\n\n`
    for (const r of failed) {
      md += `- **${r.config}**: ${r.error}\n`
    }
    md += `\n</details>\n`
  }

  md += `\n---\n*Run at ${result.timestamp} on \`${result.branch}\` (${result.gitSha.slice(0, 7)})*\n`
  return md
}

export function writeResults(result: BenchmarkSuiteResult, opts: { output?: string; outputMd?: string }): void {
  if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(result, null, 2))
    console.log(`JSON results written to: ${opts.output}`)
  }
  if (opts.outputMd) {
    writeFileSync(opts.outputMd, generateMarkdown(result))
    console.log(`Markdown summary written to: ${opts.outputMd}`)
  }
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}K`
  return String(tokens)
}
