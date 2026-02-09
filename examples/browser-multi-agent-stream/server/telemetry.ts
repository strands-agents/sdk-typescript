/**
 * Optional OpenTelemetry setup: when OTEL_ENABLED=1, registers a global
 * TracerProvider and buffers spans for the frontend GET /api/telemetry.
 * Set OTEL_CONSOLE_EXPORT=1 if you also want raw spans printed to stdout.
 */

const OTEL_ENABLED = process.env.OTEL_ENABLED === '1' || process.env.OTEL_ENABLED === 'true'
const OTEL_CONSOLE_EXPORT =
  process.env.OTEL_CONSOLE_EXPORT === '1' || process.env.OTEL_CONSOLE_EXPORT === 'true'

const MAX_TELEMETRY_ENTRIES = 500
const MAX_STRING_ATTRIBUTE_CHARS = 1200
const MAX_OBJECT_KEYS = 40
const MAX_ARRAY_ITEMS = 40

export interface TelemetryEvent {
  name: string
  timeMs: number
  attributes: Record<string, unknown>
}

export interface TelemetryEntry {
  name: string
  startTime: number
  endTime: number
  durationMs: number
  attributes: Record<string, unknown>
  statusCode?: number
  statusMessage?: string
  events: TelemetryEvent[]
}

let inMemoryExporter: { getFinishedSpans: () => unknown[] } | null = null

function hrTimeToMs(hrTime: [number, number]): number {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_ATTRIBUTE_CHARS) return value
  const omitted = value.length - MAX_STRING_ATTRIBUTE_CHARS
  return `${value.slice(0, MAX_STRING_ATTRIBUTE_CHARS)}… [truncated ${omitted} chars]`
}

function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateString(value)
  if (
    value == null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value
  }
  if (depth >= 4) return '[depth-truncated]'
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeTelemetryValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      out.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`)
    }
    return out
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, val] of entries.slice(0, MAX_OBJECT_KEYS)) {
      out[key] = sanitizeTelemetryValue(val, depth + 1)
    }
    if (entries.length > MAX_OBJECT_KEYS) {
      out.__truncated_keys = entries.length - MAX_OBJECT_KEYS
    }
    return out
  }
  return String(value)
}

function spanAttributesToPlain(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v !== undefined && v !== null) out[k] = sanitizeTelemetryValue(v)
  }
  return out
}

function normalizeEvents(events: Array<{ name?: string; time?: [number, number]; attributes?: Record<string, unknown> }>): TelemetryEvent[] {
  if (!Array.isArray(events)) return []
  return events.map((ev) => ({
    name: ev.name ?? 'event',
    timeMs: Array.isArray(ev.time) ? hrTimeToMs(ev.time) : 0,
    attributes: spanAttributesToPlain(ev.attributes ?? {}),
  }))
}

export function getTelemetryEntries(): TelemetryEntry[] {
  if (!inMemoryExporter) return []
  const spans = inMemoryExporter.getFinishedSpans() as Array<{
    name: string
    startTime?: [number, number]
    endTime?: [number, number]
    duration?: [number, number]
    attributes?: Record<string, unknown>
    status?: { code?: number; message?: string }
    events?: Array<{ name?: string; time?: [number, number]; attributes?: Record<string, unknown> }>
  }>
  const mapped = spans.slice(-MAX_TELEMETRY_ENTRIES).map((s) => {
    const startMs = s.startTime ? hrTimeToMs(s.startTime) : 0
    const endMs = s.endTime ? hrTimeToMs(s.endTime) : startMs
    const durationMs = s.duration ? hrTimeToMs(s.duration) : endMs - startMs
    return {
      name: s.name,
      startTime: startMs,
      endTime: endMs,
      durationMs,
      attributes: spanAttributesToPlain(s.attributes ?? {}),
      statusCode: s.status?.code,
      statusMessage: s.status?.message,
      events: normalizeEvents(s.events ?? []),
    }
  })
  mapped.sort((a, b) => b.startTime - a.startTime)
  return mapped
}

export async function registerTelemetry(): Promise<void> {
  if (!OTEL_ENABLED) return

  const { trace } = await import('@opentelemetry/api')
  const {
    NodeTracerProvider,
    SimpleSpanProcessor,
    InMemorySpanExporter,
    ConsoleSpanExporter,
  } = await import('@opentelemetry/sdk-trace-node')

  const memory = new InMemorySpanExporter()
  inMemoryExporter = memory

  const spanProcessors = [new SimpleSpanProcessor(memory)]
  if (OTEL_CONSOLE_EXPORT) {
    const consoleExporter = new ConsoleSpanExporter()
    spanProcessors.push(new SimpleSpanProcessor(consoleExporter))
  }

  const provider = new NodeTracerProvider({
    spanProcessors,
  })
  provider.register()
  trace.setGlobalTracerProvider(provider)
}
