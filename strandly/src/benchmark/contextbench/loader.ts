import { execSync } from 'node:child_process'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ContextBenchTask, GoldAnnotation } from '../types.js'

const CACHE_DIR = resolve(import.meta.dirname, '../../../../.cache/contextbench')
const CONTEXTBENCH_REPO = 'https://github.com/EuniAI/ContextBench.git'

export function ensureContextBenchCloned(): string {
  const repoDir = join(CACHE_DIR, 'contextbench-repo')

  if (!existsSync(join(repoDir, '.git'))) {
    mkdirSync(CACHE_DIR, { recursive: true })
    console.log('Cloning ContextBench repository...')
    execSync(`git clone --depth 1 ${CONTEXTBENCH_REPO} ${repoDir}`, { stdio: 'inherit' })
  }

  return repoDir
}

export function ensureDependencies(): void {
  try {
    execSync('python3 -c "import pyarrow; import tree_sitter"', { stdio: 'pipe' })
  } catch {
    throw new Error(
      'Missing Python dependencies for ContextBench evaluation.\n' +
        'Install with: pip install pyarrow tree-sitter tree-sitter-languages datasets'
    )
  }
}

export function loadTask(taskId: string): ContextBenchTask {
  const contextbenchDir = ensureContextBenchCloned()
  const goldParquet = join(contextbenchDir, 'data', 'contextbench_verified.parquet')

  if (!existsSync(goldParquet)) {
    throw new Error(`Gold data not found at ${goldParquet}`)
  }

  const tmp = join(CACHE_DIR, 'tmp')
  mkdirSync(tmp, { recursive: true })

  const scriptFile = join(tmp, 'load_task.py')
  const parquetPath = JSON.stringify(goldParquet)
  const taskIdStr = JSON.stringify(taskId)
  writeFileSync(
    scriptFile,
`import pyarrow.parquet as pq, json, sys

df = pq.read_table(${parquetPath}).to_pandas()
task_id = ${taskIdStr}

row = df[df["original_inst_id"] == task_id]
if row.empty:
    row = df[df["instance_id"].str.contains(task_id)]
if row.empty:
    print(json.dumps({"error": "Task not found: " + task_id}))
    sys.exit(0)

r = row.iloc[0]
print(json.dumps({
    "instance_id": str(r["instance_id"]),
    "original_inst_id": str(r["original_inst_id"]),
    "repo": str(r["repo"]),
    "repo_url": str(r["repo_url"]),
    "base_commit": str(r["base_commit"]),
    "problem_statement": str(r["problem_statement"]),
    "gold_context": str(r["gold_context"]),
}))
`)

  const output = execSync(`python3 ${scriptFile}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
  const data = JSON.parse(output.trim())

  if (data.error) {
    throw new Error(data.error)
  }

  const goldContext: Array<{ file: string; start_line?: number; end_line?: number }> = JSON.parse(
    data.gold_context
  )

  return {
    id: data.original_inst_id,
    repo: data.repo,
    issue: extractIssueNumber(data.original_inst_id),
    baseCommit: data.base_commit,
    prompt: buildPrompt(data.problem_statement, data.repo),
    goldAnnotations: parseGoldContext(goldContext),
  }
}

export function ensureRepoCloned(task: ContextBenchTask): string {
  if (!/^[0-9a-f]+$/i.test(task.baseCommit)) {
    throw new Error(`Invalid base commit: ${task.baseCommit}`)
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(task.repo)) {
    throw new Error(`Invalid repo format: ${task.repo}`)
  }

  const repoDir = join(CACHE_DIR, 'repos', task.repo.replace('/', '__'))

  if (!existsSync(join(repoDir, '.git'))) {
    mkdirSync(join(CACHE_DIR, 'repos'), { recursive: true })
    console.log(`  Cloning ${task.repo}...`)
    execSync(`git clone --depth 100 https://github.com/${task.repo}.git ${repoDir}`, {
      stdio: 'inherit',
    })
  }

  execSync(`git checkout ${task.baseCommit} 2>/dev/null || git fetch --depth 100 origin ${task.baseCommit} && git checkout ${task.baseCommit}`, {
    cwd: repoDir,
    stdio: 'pipe',
  })

  return repoDir
}

export function listTasks(): string[] {
  const contextbenchDir = ensureContextBenchCloned()
  const goldParquet = join(contextbenchDir, 'data', 'contextbench_verified.parquet')

  const tmp = join(CACHE_DIR, 'tmp')
  mkdirSync(tmp, { recursive: true })

  const scriptFile = join(tmp, 'list_tasks.py')
  const parquetPath = JSON.stringify(goldParquet)
  writeFileSync(
    scriptFile,
`import pyarrow.parquet as pq, json

t = pq.read_table(${parquetPath}, columns=["original_inst_id"])
ids = t.column("original_inst_id").to_pylist()
print(json.dumps(ids[:20]))
`)

  const output = execSync(`python3 ${scriptFile}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
  return JSON.parse(output.trim())
}

function buildPrompt(problemStatement: string, repo: string): string {
  return `You are a code investigation agent. Your task is to find all relevant code locations for the following GitHub issue in the ${repo} repository.

## Issue

${problemStatement}

Investigate the repository to find all files, functions, and code spans relevant to this issue. Use the available tools to read files and search the codebase. Be thorough — find all relevant locations, not just the first match.

When you are done, list all the files and specific line ranges you found to be relevant.`
}

function parseGoldContext(
  goldContext: Array<{ file: string; start_line?: number; end_line?: number }>
): GoldAnnotation[] {
  const byFile = new Map<string, GoldAnnotation>()

  for (const entry of goldContext) {
    let annotation = byFile.get(entry.file)
    if (!annotation) {
      annotation = { file: entry.file, spans: [] }
      byFile.set(entry.file, annotation)
    }
    if (entry.start_line != null && entry.end_line != null) {
      annotation.spans!.push({ startLine: entry.start_line, endLine: entry.end_line })
    }
  }

  return [...byFile.values()]
}

function extractIssueNumber(instanceId: string): number {
  const match = instanceId.match(/-(\d+)$/)
  return match ? parseInt(match[1]!, 10) : 0
}
