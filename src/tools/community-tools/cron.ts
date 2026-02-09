import { spawnSync } from 'node:child_process'
import { FunctionTool } from '../function-tool.js'
import type { JSONValue } from '../../types/json.js'

interface CronInput {
  action?: string
  schedule?: string
  command?: string
  jobId?: number
  description?: string
}

interface CrontabReadResult {
  text: string
}

function success(text: string): JSONValue {
  return { status: 'success', content: [{ text }] }
}

function error(text: string): JSONValue {
  return { status: 'error', content: [{ text }] }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function sanitizeDescription(description: string): string {
  return description.replace(/[\r\n]+/g, ' ').trim()
}

function runCrontab(args: string[], input?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('crontab', args, {
    encoding: 'utf8',
    input,
  })

  if (result.error != null) {
    throw result.error
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

function readCrontab(): CrontabReadResult {
  const result = runCrontab(['-l'])
  if (result.status !== 0) {
    if (result.stderr.includes('no crontab for')) {
      return { text: '' }
    }
    throw new Error(`Failed to read crontab: ${result.stderr.trim() || 'unknown error'}`)
  }
  return { text: result.stdout }
}

function writeCrontab(content: string): void {
  const result = runCrontab(['-'], content)
  if (result.status !== 0) {
    throw new Error(`Failed to write crontab: ${result.stderr.trim() || 'unknown error'}`)
  }
}

function listJobs(): JSONValue {
  try {
    const crontab = readCrontab().text
    const jobs: Array<{ id: number; line: string }> = []

    const lines = crontab.split('\n')
    lines.forEach((rawLine, idx) => {
      const line = rawLine.trim()
      if (line.length > 0 && !line.startsWith('#')) {
        jobs.push({ id: idx, line })
      }
    })

    if (jobs.length === 0) {
      return success('No cron jobs found in crontab')
    }

    const sections = [`Found ${jobs.length} cron jobs:`]
    for (const job of jobs) {
      sections.push(`ID: ${job.id}\n${job.line}`)
    }
    return success(sections.join('\n'))
  } catch (err) {
    return error(`Error listing cron jobs: ${toMessage(err)}`)
  }
}

function addJob(schedule: string, command: string, description?: string): JSONValue {
  try {
    const crontab = readCrontab().text
    const descriptionText = description != null && description.length > 0 ? `# ${sanitizeDescription(description)}` : ''
    const cronLine = `${schedule} ${command} ${descriptionText}`.trim()

    const newCrontab = crontab.length > 0 ? `${crontab.trimEnd()}\n${cronLine}\n` : `${cronLine}\n`
    writeCrontab(newCrontab)

    return success(`Successfully added new cron job: ${cronLine}`)
  } catch (err) {
    return error(`Error adding cron job: ${toMessage(err)}`)
  }
}

function addRawEntry(rawEntry: string): JSONValue {
  try {
    const crontab = readCrontab().text
    const newCrontab = crontab.length > 0 ? `${crontab.trimEnd()}\n${rawEntry}\n` : `${rawEntry}\n`
    writeCrontab(newCrontab)
    return success(`Successfully added raw crontab entry: ${rawEntry}`)
  } catch (err) {
    return error(`Error adding raw crontab entry: ${toMessage(err)}`)
  }
}

function removeJob(jobId: number): JSONValue {
  try {
    const crontab = readCrontab().text
    const lines = crontab.split('\n').filter((line, idx, all) => !(line.length === 0 && idx === all.length - 1))

    if (jobId < 0 || jobId >= lines.length) {
      return error(`Error: Job ID ${jobId} is out of range`)
    }

    const removed = lines[jobId]
    lines.splice(jobId, 1)
    const newCrontab = lines.length > 0 ? `${lines.join('\n')}\n` : ''
    writeCrontab(newCrontab)

    return success(`Successfully removed cron job: ${removed}`)
  } catch (err) {
    return error(`Error removing cron job: ${toMessage(err)}`)
  }
}

function editJob(jobId: number, schedule?: string, command?: string, description?: string): JSONValue {
  try {
    const crontab = readCrontab().text
    const lines = crontab.split('\n').filter((line, idx, all) => !(line.length === 0 && idx === all.length - 1))

    if (jobId < 0 || jobId >= lines.length) {
      return error(`Error: Job ID ${jobId} is out of range`)
    }

    const oldLineRaw = lines[jobId]
    if (oldLineRaw == null) {
      return error(`Error: Job ID ${jobId} is out of range`)
    }
    const oldLine = oldLineRaw.trim()
    if (oldLine.startsWith('#')) {
      return error(`Error: Line ${jobId} is a comment, not a cron job`)
    }

    const parts = oldLine.split(/\s+/, 6)
    if (parts.length < 6) {
      return error('Error: Invalid cron format')
    }

    const oldSchedule = parts.slice(0, 5).join(' ')
    const oldCommandRest = parts[5] ?? ''
    const commentIndex = oldCommandRest.indexOf('#')
    const oldCommand = commentIndex >= 0 ? oldCommandRest.slice(0, commentIndex).trim() : oldCommandRest.trim()
    const oldComment = commentIndex >= 0 ? oldCommandRest.slice(commentIndex).trim() : ''

    const newSchedule = schedule ?? oldSchedule
    const newCommand = command ?? oldCommand
    const newComment = description != null ? `# ${sanitizeDescription(description)}` : oldComment

    const newCronLine = `${newSchedule} ${newCommand} ${newComment}`.trim()
    lines[jobId] = newCronLine

    writeCrontab(`${lines.join('\n')}\n`)
    return success(`Successfully updated cron job to: ${newCronLine}`)
  } catch (err) {
    return error(`Error editing cron job: ${toMessage(err)}`)
  }
}

function runCron(input: CronInput): JSONValue {
  try {
    const action = input.action?.toLowerCase()
    switch (action) {
      case 'list':
        return listJobs()
      case 'add':
        if (input.schedule == null || input.schedule.length === 0) {
          return error('Error: Schedule is required')
        }
        if (input.command == null || input.command.length === 0) {
          return error('Error: Command is required')
        }
        return addJob(input.schedule, input.command, input.description)
      case 'raw':
        if (input.command == null || input.command.length === 0) {
          return error('Error: Raw crontab entry required')
        }
        return addRawEntry(input.command)
      case 'remove':
        if (input.jobId == null) {
          return error('Error: Job ID is required')
        }
        return removeJob(input.jobId)
      case 'edit':
        if (input.jobId == null) {
          return error('Error: Job ID is required')
        }
        return editJob(input.jobId, input.schedule, input.command, input.description)
      default:
        return error(`Error: Unknown action '${input.action ?? ''}'`)
    }
  } catch (err) {
    return error(`Error: ${toMessage(err)}`)
  }
}

export const cron = new FunctionTool({
  name: 'cron',
  description: 'Manage crontab entries with list/add/remove/edit/raw actions.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: "Action: 'list' | 'add' | 'remove' | 'edit' | 'raw'" },
      schedule: { type: 'string', description: 'Cron schedule expression (for add/edit)' },
      command: { type: 'string', description: 'Command to execute (or raw cron line for raw action)' },
      jobId: { type: 'number', description: 'Line number to remove/edit' },
      description: { type: 'string', description: 'Optional job description appended as a comment' },
    },
    required: ['action'],
  },
  callback: (input: unknown): JSONValue => runCron((input ?? {}) as CronInput),
})
