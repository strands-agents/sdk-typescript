import { FunctionTool } from '../function-tool.js'

const DEFAULT_TIMEZONE = globalThis?.process?.env?.DEFAULT_TIMEZONE ?? 'UTC'

interface CurrentTimeInput {
  timezone?: string
}

function getOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const map = new Map(parts.map((part) => [part.type, part.value]))
  const localIso = `${map.get('year')}-${map.get('month')}-${map.get('day')}T${map.get('hour')}:${map.get('minute')}:${map.get('second')}Z`
  const localAsUtc = new Date(localIso)
  return Math.round((localAsUtc.getTime() - date.getTime()) / 60000)
}

function formatOffset(totalMinutes: number): string {
  const sign = totalMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(totalMinutes)
  const hh = String(Math.floor(absolute / 60)).padStart(2, '0')
  const mm = String(absolute % 60).padStart(2, '0')
  return `${sign}${hh}:${mm}`
}

function formatInTimezoneIso(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const map = new Map(parts.map((part) => [part.type, part.value]))
  const offset = formatOffset(getOffsetMinutes(date, timeZone))
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}T${map.get('hour')}:${map.get('minute')}:${map.get('second')}.000${offset}`
}

function getCurrentTime(input: CurrentTimeInput): string {
  const tz = input.timezone || DEFAULT_TIMEZONE
  const now = new Date()
  try {
    return formatInTimezoneIso(now, tz)
  } catch {
    throw new Error(`Invalid timezone '${tz}'`) // surfaced by FunctionTool as error result
  }
}

export const currentTime = new FunctionTool({
  name: 'current_time',
  description:
    'Get the current time in ISO 8601 format. Optionally specify a timezone (e.g. UTC, US/Pacific, Europe/London).',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone (e.g. UTC, US/Pacific). Defaults to env DEFAULT_TIMEZONE or UTC.',
      },
    },
  },
  callback: (input: unknown): string => getCurrentTime((input ?? {}) as CurrentTimeInput),
})
