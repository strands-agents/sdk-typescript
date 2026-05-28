import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ContextBenchTask, EvaluationMetrics } from './types.js'
import { ensureContextBenchCloned } from './contextbench/loader.js'

export async function evaluate(
  task: ContextBenchTask,
  filesRead: string[],
  spans?: Record<string, Array<{ start: number; end: number }>>
): Promise<EvaluationMetrics> {
  const contextbenchDir = ensureContextBenchCloned()
  const goldParquet = join(contextbenchDir, 'data', 'contextbench_verified.parquet')
  const tmp = mkdtempSync(join(tmpdir(), 'bench-eval-'))

  const predData = {
    instance_id: task.id,
    original_inst_id: task.id,
    repo_url: `https://github.com/${task.repo}.git`,
    commit: task.baseCommit,
    traj_data: {
      pred_steps: [{ files: filesRead, spans: spans ?? {}, symbols: {} }],
      pred_files: filesRead,
      pred_spans: spans ?? {},
      pred_symbols: {},
    },
  }

  const predFile = join(tmp, 'pred.jsonl')
  writeFileSync(predFile, JSON.stringify(predData) + '\n')

  const scriptFile = join(tmp, 'evaluate.py')
  const cbDir = JSON.stringify(contextbenchDir)
  const goldPath = JSON.stringify(goldParquet)
  const predPath = JSON.stringify(predFile)
  const reposDir = JSON.stringify(join(tmp, 'repos'))
  writeFileSync(
    scriptFile,
`import sys, os, io, json

sys.path.insert(0, ${cbDir})
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

_real_stdout = sys.stdout
sys.stdout = io.StringIO()
sys.stderr = open(os.devnull, "w")

from contextbench.evaluate import evaluate_instance
from contextbench.parsers import GoldLoader

gold_loader = GoldLoader(${goldPath})
pred_data = json.loads(open(${predPath}).readline())
instance_id = pred_data["instance_id"]
original_id = pred_data.get("original_inst_id", instance_id)

gold = gold_loader.get(instance_id) or gold_loader.get(original_id)
if not gold:
    sys.stdout = _real_stdout
    print(json.dumps({"error": "no_gold_found"}))
    sys.exit(0)

result = evaluate_instance(instance_id, gold, pred_data, ${reposDir})
sys.stdout = _real_stdout
print(json.dumps(result, default=str))
`)

  const output = execSync(`python3 ${scriptFile}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  })

  const result = JSON.parse(output.trim())

  if (result.error) {
    console.warn(`  Evaluation error: ${result.error}`)
    return emptyMetrics()
  }

  return extractMetrics(result)
}

function extractMetrics(result: Record<string, unknown>): EvaluationMetrics {
  const final = (result.final ?? {}) as Record<string, Record<string, number>>
  const editloc = (result.editloc ?? {}) as Record<string, number>

  return {
    fileCoverage: final.file?.coverage ?? 0,
    filePrecision: final.file?.precision ?? 0,
    symbolCoverage: final.symbol?.coverage ?? 0,
    symbolPrecision: final.symbol?.precision ?? 0,
    spanCoverage: final.span?.coverage ?? 0,
    spanPrecision: final.span?.precision ?? 0,
    editLocRecall: editloc.recall ?? 0,
    editLocPrecision: editloc.precision ?? 0,
  }
}

function emptyMetrics(): EvaluationMetrics {
  return {
    fileCoverage: 0,
    filePrecision: 0,
    symbolCoverage: 0,
    symbolPrecision: 0,
    spanCoverage: 0,
    spanPrecision: 0,
    editLocRecall: 0,
    editLocPrecision: 0,
  }
}
