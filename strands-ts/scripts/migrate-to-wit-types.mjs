#!/usr/bin/env node
/**
 * One-shot migration from hand-written message types to WIT-generated types.
 *
 * Idempotent from a clean `src/`:
 *   git checkout strands-ts/src && node strands-ts/scripts/migrate-to-wit-types.mjs
 *
 * Passes (in order):
 *   1. Rewrite strands-ts/src/types/messages.ts to re-export generated types.
 *   2. Strip `new ClassName({...})` → `{...}` with balanced-paren matching.
 *      Arrow-body case (`=> new X({...})`) gets wrapped in parens so the
 *      literal parses as an expression, not a block.
 *   3. Wrap single-arg `new TextBlock(s)` / `new JsonBlock(s)` into tagged
 *      content-block variants `{ tag: 'text', val: { text: s } }`.
 *
 * Run the script, then `tsc --noEmit` to see remaining errors. Each new
 * pattern we discover becomes another pass in this file.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
const srcDir = path.join(repoRoot, 'strands-ts', 'src')

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      out.push(...listFiles(full))
    } else if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

// ----------------------------------------------------------------------------
// Pass 0 — rewrite index.ts message-exports block.
// Message class stays as value; everything else becomes type-only.
// Serialization helpers (contentBlockFromData etc.) are gone.
// ----------------------------------------------------------------------------
function rewriteIndexTs() {
  const file = path.join(srcDir, 'index.ts')
  let src = fs.readFileSync(file, 'utf8')

  // Match the `// Message types` block through the `// Message classes` block
  // (flexible about the exact contents of each export list).
  const blockRe = /\/\/ Message types[\s\S]*?\/\/ Message classes[\s\S]*?\} from '\.\/types\/messages\.js'/m
  const replacement = `// Message types
export type {
  Role,
  StopReason,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ReasoningBlock,
  CachePointBlock,
  GuardContentBlock,
  GuardContentText,
  GuardContentImage,
  GuardQualifier,
  GuardImageFormat,
  ContentBlock,
  SystemPrompt,
  SystemContentBlock,
  ToolResultContent,
  JsonBlock,
} from './types/messages.js'

// Message class wrapper
export { Message } from './types/messages.js'`

  if (blockRe.test(src)) {
    src = src.replace(blockRe, replacement)
    fs.writeFileSync(file, src)
    console.error(`rewrote index.ts message exports`)
  }
}

// ----------------------------------------------------------------------------
// Pass 0c — rewrite media.ts. Keep cross-platform base64 helpers (they're
// not types). All block/source types come from WIT. Classes become thin
// construction wrappers around the records.
// ----------------------------------------------------------------------------
function rewriteMediaTs() {
  const file = path.join(srcDir, 'types', 'media.ts')
  const content = `/**
 * Media types — images, videos, documents.
 *
 * Source of truth: \`wit/messages.wit\`. Types re-exported from the
 * generated bindings. Only base64 helpers and thin class wrappers live here.
 */

export type {
  ImageFormat,
  ImageSource,
  ImageBlock,
  VideoFormat,
  VideoSource,
  VideoBlock,
  DocumentFormat,
  DocumentSource,
  DocumentBlock,
  S3Location,
} from '../../generated/interfaces/strands-agent-messages.js'

/**
 * Cross-platform base64 encoding function. Works in both browser and Node.
 */
export function encodeBase64(input: string | Uint8Array): string {
  if (typeof input !== 'string') {
    let binary = ''
    for (let i = 0; i < input.length; i++) {
      binary += String.fromCharCode(input[i]!)
    }
    return encodeBase64(binary)
  }

  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(input)
  }

  return globalThis.Buffer.from(input, 'binary').toString('base64')
}

/**
 * Cross-platform base64 decoding function. Returns raw bytes as Uint8Array.
 */
export function decodeBase64(input: string): Uint8Array {
  if (typeof globalThis.Buffer === 'function') {
    return new Uint8Array(globalThis.Buffer.from(input, 'base64'))
  }

  const binary = globalThis.atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
`
  fs.writeFileSync(file, content)
  console.error(`rewrote media.ts`)
}

// ----------------------------------------------------------------------------
// Pass 0d — rewrite citations.ts as re-exports.
// ----------------------------------------------------------------------------
function rewriteCitationsTs() {
  const file = path.join(srcDir, 'types', 'citations.ts')
  const content = `/**
 * Citation types for document citation content blocks.
 *
 * Source of truth: \`wit/messages.wit\`. All citation shapes re-exported
 * from the generated bindings.
 */

export type {
  Citation,
  CitationLocation,
  CitationSourceContent,
  CitationGeneratedContent,
  CitationsBlock,
} from '../../generated/interfaces/strands-agent-messages.js'
`
  fs.writeFileSync(file, content)
  console.error(`rewrote citations.ts`)
}

// ----------------------------------------------------------------------------
// Pass 0b — rewrite slim-types.ts. The old file wrapped classes in
// `NoJSON<T>` to strip `.toJSON` from test fixture types. After WIT,
// records have no methods; `NoJSON` and `PlainContentBlock` collapse
// into direct re-exports of the generated types.
// ----------------------------------------------------------------------------
function rewriteSlimTypes() {
  const file = path.join(srcDir, '__fixtures__', 'slim-types.ts')
  const content = `/**
 * Test-fixture type aliases.
 *
 * Kept as a compatibility shim for existing tests. After the WIT migration,
 * content blocks are plain records (no class, no \`toJSON\`), so these
 * aliases just forward to the generated types.
 */

import type {
  Message,
  ContentBlock,
  SystemContentBlock,
  ToolResultBlock,
} from '../types/messages.js'

export type NoJSON<T> = T

export type PlainContentBlock = ContentBlock
export type PlainSystemContentBlock = SystemContentBlock
export type PlainToolResultBlock = ToolResultBlock
export type PlainMessage = Message

export type { Message }
`
  fs.writeFileSync(file, content)
  console.error(`rewrote slim-types.ts`)
}

// ----------------------------------------------------------------------------
// Pass 1 — rewrite messages.ts
// ----------------------------------------------------------------------------
function rewriteMessagesTs() {
  const file = path.join(srcDir, 'types', 'messages.ts')
  const content = `/**
 * Message and content-block types.
 *
 * Source of truth: \`wit/messages.wit\`. Types are generated by jco into
 * \`strands-ts/generated/interfaces/strands-agent-messages.d.ts\` and re-exported
 * here unchanged. Add nothing to this file that isn't a re-export or a thin
 * construction wrapper — logic belongs at consumer sites or in the WIT contract.
 */

export type {
  Role,
  MessageUsage,
  MessageMetrics,
  MessageMetadata,
  TextBlock,
  JsonBlock,
  ToolUseBlock,
  ToolStatus,
  ReasoningBlock,
  CacheType,
  CachePointBlock,
  GuardQualifier,
  GuardContentText,
  GuardImageFormat,
  GuardContentImage,
  GuardContentBlock,
  ImageFormat,
  ImageSource,
  ImageBlock,
  VideoFormat,
  VideoSource,
  VideoBlock,
  DocumentFormat,
  DocumentSource,
  DocumentBlock,
  ToolResultContent,
  ToolResultBlock,
  CitationLocation,
  Citation,
  CitationsBlock,
  ContentBlock,
  SystemContentBlock,
  SystemPrompt,
  StopReason,
} from '../../generated/interfaces/strands-agent-messages.js'

import type {
  Role,
  ContentBlock,
  MessageMetadata,
  Message as WitMessage,
} from '../../generated/interfaces/strands-agent-messages.js'

/**
 * A message in a conversation between user and assistant.
 *
 * Constructor wrapper over the WIT \`Message\` record. Use the constructor
 * for ergonomic creation; the generated \`Message\` type is the shape
 * signature consumers should reference.
 */
export class Message implements WitMessage {
  readonly role: Role
  readonly content: ContentBlock[]
  readonly metadata?: MessageMetadata

  constructor(data: { role: Role; content: ContentBlock[]; metadata?: MessageMetadata }) {
    this.role = data.role
    this.content = data.content
    if (data.metadata !== undefined) {
      this.metadata = data.metadata
    }
  }
}
`
  fs.writeFileSync(file, content)
  console.error(`rewrote ${path.relative(repoRoot, file)}`)
}

// ----------------------------------------------------------------------------
// Pass 2 — balanced-paren strip: `new ClassName(BODY)` → `BODY`
//
// Arrow-body detection: if the ctor directly follows `=>` (whitespace/newlines
// only between), wrap stripped body in `(...)` so object literal parses as
// expression, not block.
// ----------------------------------------------------------------------------
function stripConstructor(src, className) {
  const needle = `new ${className}(`
  let out = ''
  let i = 0
  let changed = false

  while (i < src.length) {
    const idx = src.indexOf(needle, i)
    if (idx === -1) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, idx)

    // Detect `=> whitespace new X(` — arrow-return case.
    const pre = src.slice(0, idx)
    const arrowMatch = /=>\s*$/.test(pre)

    // Walk to matching `)` respecting strings/templates/comments.
    let p = idx + needle.length
    let depth = 1
    let mode = null // '"', "'", 'template', 'line-comment', 'block-comment'
    let templateDepth = 0
    let escape = false
    let found = -1

    while (p < src.length) {
      const ch = src[p]
      if (escape) {
        escape = false
        p++
        continue
      }
      if (mode === 'line-comment') {
        if (ch === '\n') mode = null
        p++
        continue
      }
      if (mode === 'block-comment') {
        if (ch === '*' && src[p + 1] === '/') {
          mode = null
          p += 2
          continue
        }
        p++
        continue
      }
      if (mode === '"' || mode === "'") {
        if (ch === '\\') {
          escape = true
          p++
          continue
        }
        if (ch === mode) mode = null
        p++
        continue
      }
      if (mode === 'template') {
        if (ch === '\\') {
          escape = true
          p++
          continue
        }
        if (ch === '`' && templateDepth === 0) {
          mode = null
          p++
          continue
        }
        if (ch === '$' && src[p + 1] === '{') {
          templateDepth++
          p += 2
          continue
        }
        if (ch === '}' && templateDepth > 0) {
          templateDepth--
          p++
          continue
        }
        p++
        continue
      }
      // not in string/comment
      if (ch === '/' && src[p + 1] === '/') {
        mode = 'line-comment'
        p += 2
        continue
      }
      if (ch === '/' && src[p + 1] === '*') {
        mode = 'block-comment'
        p += 2
        continue
      }
      if (ch === '"' || ch === "'") {
        mode = ch
        p++
        continue
      }
      if (ch === '`') {
        mode = 'template'
        p++
        continue
      }
      if (ch === '(') {
        depth++
        p++
        continue
      }
      if (ch === ')') {
        depth--
        if (depth === 0) {
          found = p
          break
        }
        p++
        continue
      }
      p++
    }

    if (found === -1) {
      // Unclosed — bail, emit remainder unchanged.
      out += src.slice(idx)
      break
    }

    const body = src.slice(idx + needle.length, found)
    out += arrowMatch ? `(${body})` : body
    i = found + 1
    changed = true
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 3 — `new TextBlock(x)` → `{ tag: 'text', val: { text: x } }`
//
// Same balanced-paren scan as pass 2, but with a transform on the body.
// ----------------------------------------------------------------------------
function wrapTextBlock(src) {
  const needle = `new TextBlock(`
  let out = ''
  let i = 0
  let changed = false

  while (i < src.length) {
    const idx = src.indexOf(needle, i)
    if (idx === -1) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, idx)

    // Arrow-return detection: if the ctor is the direct body of an arrow,
    // wrap the literal in parens so it parses as an expression.
    const arrowMatch = /=>\s*$/.test(src.slice(0, idx))

    let p = idx + needle.length
    let depth = 1
    let mode = null
    let templateDepth = 0
    let escape = false
    let found = -1

    while (p < src.length) {
      const ch = src[p]
      if (escape) {
        escape = false
        p++
        continue
      }
      if (mode === 'line-comment') {
        if (ch === '\n') mode = null
        p++
        continue
      }
      if (mode === 'block-comment') {
        if (ch === '*' && src[p + 1] === '/') {
          mode = null
          p += 2
          continue
        }
        p++
        continue
      }
      if (mode === '"' || mode === "'") {
        if (ch === '\\') {
          escape = true
          p++
          continue
        }
        if (ch === mode) mode = null
        p++
        continue
      }
      if (mode === 'template') {
        if (ch === '\\') {
          escape = true
          p++
          continue
        }
        if (ch === '`' && templateDepth === 0) {
          mode = null
          p++
          continue
        }
        if (ch === '$' && src[p + 1] === '{') {
          templateDepth++
          p += 2
          continue
        }
        if (ch === '}' && templateDepth > 0) {
          templateDepth--
          p++
          continue
        }
        p++
        continue
      }
      if (ch === '/' && src[p + 1] === '/') {
        mode = 'line-comment'
        p += 2
        continue
      }
      if (ch === '/' && src[p + 1] === '*') {
        mode = 'block-comment'
        p += 2
        continue
      }
      if (ch === '"' || ch === "'") {
        mode = ch
        p++
        continue
      }
      if (ch === '`') {
        mode = 'template'
        p++
        continue
      }
      if (ch === '(') {
        depth++
        p++
        continue
      }
      if (ch === ')') {
        depth--
        if (depth === 0) {
          found = p
          break
        }
        p++
        continue
      }
      p++
    }

    if (found === -1) {
      out += src.slice(idx)
      break
    }

    const body = src.slice(idx + needle.length, found).trim()
    const literal = `{ tag: 'text' as const, val: { text: ${body} } }`
    out += arrowMatch ? `(${literal})` : literal
    i = found + 1
    changed = true
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 4 — discriminator checks replacing `instanceof X` and
// `toBeInstanceOf(X)` for former block classes.
// ----------------------------------------------------------------------------
// All former block classes are now WIT records. `instanceof X` becomes a
// tag discriminator check; `import { X }` becomes `import type`.
const tagFor = {
  TextBlock: 'text',
  ToolUseBlock: 'tool-use',
  ToolResultBlock: 'tool-result',
  JsonBlock: 'json',
  ReasoningBlock: 'reasoning',
  CachePointBlock: 'cache-point',
  GuardContentBlock: 'guard-content',
  ImageBlock: 'image',
  VideoBlock: 'video',
  DocumentBlock: 'document',
  CitationsBlock: 'citations',
  S3Location: 's3-location',
}

function replaceInstanceChecks(src) {
  let changed = false
  let out = src

  for (const [cls, tag] of Object.entries(tagFor)) {
    // expect(x).toBeInstanceOf(X) → expect(x).toHaveProperty('tag', 'tag')
    const beInstance = new RegExp(`\\.toBeInstanceOf\\(${cls}\\)`, 'g')
    if (beInstance.test(out)) {
      out = out.replace(beInstance, `.toHaveProperty('tag', '${tag}')`)
      changed = true
    }
    // x instanceof X → (x as { tag?: string })?.tag === 'tag'
    const bareInstance = new RegExp(`(\\S+)\\s+instanceof\\s+${cls}\\b`, 'g')
    if (bareInstance.test(out)) {
      out = out.replace(bareInstance, `($1 as { tag?: string })?.tag === '${tag}'`)
      changed = true
    }
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 5 — `import { TextBlock, ... }` → `import type { TextBlock, ... }`
// for block classes that are now type-only.
// ----------------------------------------------------------------------------
function fixTypeOnlyImports(src) {
  const classNames = Object.keys(tagFor).join('|')
  const re = new RegExp(`^(\\s*)import\\s*\\{([^}]*(?:${classNames})[^}]*)\\}\\s*from\\s*('[^']+')`, 'gm')
  let changed = false
  const out = src.replace(re, (m, lead, names, from) => {
    if (/^\s*import\s+type/.test(m)) return m
    // Split names, separate types from values.
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean)
    const typeOnly = new Set(Object.keys(tagFor))
    const types = parts.filter((p) => typeOnly.has(p.replace(/^type\s+/, '')))
    const values = parts.filter((p) => !typeOnly.has(p.replace(/^type\s+/, '')))
    if (types.length === 0) return m
    changed = true
    const typeLine = `${lead}import type { ${types.join(', ')} } from ${from}`
    if (values.length === 0) return typeLine
    const valueLine = `${lead}import { ${values.join(', ')} } from ${from}`
    return `${typeLine}\n${valueLine}`
  })
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 6 — StopReason literals camelCase → kebab-case.
// Safe because these strings only appear as StopReason values.
// ----------------------------------------------------------------------------
const stopReasonRenames = [
  ['endTurn', 'end-turn'],
  ['toolUse', 'tool-use'],
  ['maxTokens', 'max-tokens'],
  ['contentFiltered', 'content-filtered'],
  ['guardrailIntervened', 'guardrail-intervened'],
  ['stopSequence', 'stop-sequence'],
  ['modelContextWindowExceeded', 'model-context-window-exceeded'],
]

function renameStopReasons(src) {
  let changed = false
  let out = src
  for (const [camel, kebab] of stopReasonRenames) {
    // Only rewrite quoted literals.
    const q1 = new RegExp(`'${camel}'`, 'g')
    const q2 = new RegExp(`"${camel}"`, 'g')
    if (q1.test(out)) {
      out = out.replace(q1, `'${kebab}'`)
      changed = true
    }
    if (q2.test(out)) {
      out = out.replace(q2, `"${kebab}"`)
      changed = true
    }
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 7 — block discriminator rename: `.type` → `.tag`, and the old
// camelCase block-type literals → WIT kebab tags.
//
// Trigger only when the literal appears as a comparison or case value, so
// we don't clobber unrelated string usage.
// ----------------------------------------------------------------------------
const blockTagRenames = [
  ['textBlock', 'text'],
  ['toolUseBlock', 'tool-use'],
  ['toolResultBlock', 'tool-result'],
  ['reasoningBlock', 'reasoning'],
  ['cachePointBlock', 'cache-point'],
  ['guardContentBlock', 'guard-content'],
  ['jsonBlock', 'json'],
  // Media classes stay classes, but their tags in the WIT content-block
  // variant are still kebab-case.
  ['imageBlock', 'image'],
  ['videoBlock', 'video'],
  ['documentBlock', 'document'],
  ['citationsBlock', 'citations'],
]

function renameBlockTags(src) {
  let changed = false
  let out = src
  for (const [camel, kebab] of blockTagRenames) {
    // In `case 'textBlock':` and `=== 'textBlock'`
    const cases = new RegExp(`(case\\s+)'${camel}'`, 'g')
    const eqs = new RegExp(`(===\\s*)'${camel}'`, 'g')
    const neqs = new RegExp(`(!==\\s*)'${camel}'`, 'g')
    if (cases.test(out)) {
      out = out.replace(cases, `$1'${kebab}'`)
      changed = true
    }
    if (eqs.test(out)) {
      out = out.replace(eqs, `$1'${kebab}'`)
      changed = true
    }
    if (neqs.test(out)) {
      out = out.replace(neqs, `$1'${kebab}'`)
      changed = true
    }
  }
  // `switch (x.type)` → `switch (x.tag)` — assumes these are block switches
  // since `.type` on non-block types is overwhelmingly absent from blocks/SDK.
  // Scoped to switch-heads to avoid disturbing unrelated `.type` property access.
  const switchType = /switch\s*\(\s*([^)]+?)\.type\s*\)/g
  if (switchType.test(out)) {
    out = out.replace(switchType, 'switch ($1.tag)')
    changed = true
  }
  // `.type === 'kebab-tag'` and `.type !== 'kebab-tag'` → `.tag === ...`
  // Safe: the tag string on the RHS is unambiguously a block tag.
  const kebabTags = blockTagRenames.map(([, kebab]) => kebab).join('|')
  const typeEqTag = new RegExp(`\\.type(\\s*(?:===|!==)\\s*'(?:${kebabTags})')`, 'g')
  if (typeEqTag.test(out)) {
    out = out.replace(typeEqTag, '.tag$1')
    changed = true
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 8 — drop `Data`-suffix type aliases. After the WIT migration, the
// `X` and `XData` forms collapse to the same record shape.
// ----------------------------------------------------------------------------
const dataAliases = [
  ['MessageData', 'Message'],
  ['ContentBlockData', 'ContentBlock'],
  ['SystemPromptData', 'SystemPrompt'],
  ['SystemContentBlockData', 'SystemContentBlock'],
  ['TextBlockData', 'TextBlock'],
  ['ToolUseBlockData', 'ToolUseBlock'],
  ['ToolResultBlockData', 'ToolResultBlock'],
  ['ToolResultContentData', 'ToolResultContent'],
  ['ReasoningBlockData', 'ReasoningBlock'],
  ['CachePointBlockData', 'CachePointBlock'],
  ['GuardContentBlockData', 'GuardContentBlock'],
  ['JsonBlockData', 'JsonBlock'],
]

function renameDataAliases(src) {
  let changed = false
  let out = src
  for (const [from, to] of dataAliases) {
    const re = new RegExp(`\\b${from}\\b`, 'g')
    if (re.test(out)) {
      out = out.replace(re, to)
      changed = true
    }
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 9 — drop dead serialization helpers:
//   `Message.fromMessageData(x)` → `new Message(x)`
//   `Message.fromJSON(x)` → `new Message(x)`
//   `x.toJSON()` → `x` (only when receiver is clearly a block/message)
//   `systemPromptFromData(x)` → `x`
//   `systemPromptToData(x)` → `x`
//   `contentBlockFromData(x)` → `x`
//   `toolResultContentFromData(x)` → `x`
// ----------------------------------------------------------------------------
function dropSerializationHelpers(src) {
  let changed = false
  let out = src

  const patterns = [
    [/Message\.fromMessageData\(/g, 'new Message('],
    [/Message\.fromJSON\(/g, 'new Message('],
    [/systemPromptFromData\(([^)]+)\)/g, '$1'],
    [/systemPromptToData\(([^)]+)\)/g, '$1'],
    [/contentBlockFromData\(([^)]+)\)/g, '$1'],
    [/toolResultContentFromData\(([^)]+)\)/g, '$1'],
  ]

  for (const [re, rep] of patterns) {
    if (re.test(out)) {
      out = out.replace(re, rep)
      changed = true
    }
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 10 — dedup import specifiers after renames.
// `import { Message, MessageData }` renamed to `import { Message, Message }`.
// Collapse duplicates in each import list.
// ----------------------------------------------------------------------------
function dedupImports(src) {
  let changed = false
  const re = /^(\s*)import(\s+type)?\s*\{([^}]+)\}\s*from\s*('[^']+'|"[^"]+")/gm
  const out = src.replace(re, (m, lead, typeKw, names, from) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean)
    const seen = new Set()
    const dedup = []
    for (const p of parts) {
      // Normalize `X as Y` by comparing the alias (or the name if no alias).
      const key = p.includes(' as ') ? p.split(' as ').pop().trim() : p.trim()
      if (seen.has(key)) continue
      seen.add(key)
      dedup.push(p)
    }
    if (dedup.length === parts.length) return m
    changed = true
    return `${lead}import${typeKw ?? ''} { ${dedup.join(', ')} } from ${from}`
  })
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 11 — rewrite raw block literals `{ type: 'textBlock', text: ... }`
// to the tagged-union shape. These appear in tests and internal fixtures
// that never used the class constructor.
//
// Strategy: for each single-payload block class (text/json/reasoning/cache-point),
// find `{ type: 'kebab-tag', <fields> }` and rewrite to
// `{ tag: 'kebab-tag', val: { <fields> } }`. Uses balanced-brace matching.
// ----------------------------------------------------------------------------
function rewriteRawBlockLiterals(src) {
  let changed = false
  let out = ''
  let i = 0

  // Match both camelCase (pristine) and kebab (if a prior pass already
  // rewrote the string value). kebabTags maps to its output tag.
  const literalTags = blockTagRenames.flatMap(([camel, kebab]) => [
    [camel, kebab],
    [kebab, kebab],
  ])

  while (i < src.length) {
    // Find next `{ type: '<tag>'`
    let foundIdx = -1
    let foundTag = null
    let foundNeedle = null
    for (const [srcTag, tag] of literalTags) {
      const needle = `{ type: '${srcTag}'`
      const idx = src.indexOf(needle, i)
      if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
        foundIdx = idx
        foundTag = tag
        foundNeedle = needle
      }
    }
    if (foundIdx === -1) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, foundIdx)

    // Walk to matching `}`
    const needle = foundNeedle
    let p = foundIdx + 1
    let depth = 1
    let mode = null
    let templateDepth = 0
    let escape = false
    let close = -1
    while (p < src.length) {
      const ch = src[p]
      if (escape) { escape = false; p++; continue }
      if (mode === 'line-comment') { if (ch === '\n') mode = null; p++; continue }
      if (mode === 'block-comment') {
        if (ch === '*' && src[p+1] === '/') { mode = null; p += 2; continue }
        p++; continue
      }
      if (mode === '"' || mode === "'") {
        if (ch === '\\') { escape = true; p++; continue }
        if (ch === mode) mode = null
        p++; continue
      }
      if (mode === 'template') {
        if (ch === '\\') { escape = true; p++; continue }
        if (ch === '`' && templateDepth === 0) { mode = null; p++; continue }
        if (ch === '$' && src[p+1] === '{') { templateDepth++; p += 2; continue }
        if (ch === '}' && templateDepth > 0) { templateDepth--; p++; continue }
        p++; continue
      }
      if (ch === '/' && src[p+1] === '/') { mode = 'line-comment'; p += 2; continue }
      if (ch === '/' && src[p+1] === '*') { mode = 'block-comment'; p += 2; continue }
      if (ch === '"' || ch === "'") { mode = ch; p++; continue }
      if (ch === '`') { mode = 'template'; p++; continue }
      if (ch === '{') { depth++; p++; continue }
      if (ch === '}') {
        depth--
        if (depth === 0) { close = p; break }
        p++; continue
      }
      p++
    }
    if (close === -1) {
      out += src.slice(foundIdx)
      break
    }

    // Body is between `{ type: '<tag>',` and `}`.
    const bodyStart = foundIdx + needle.length
    const bodyEnd = close
    // Strip leading comma/whitespace after the type field
    let body = src.slice(bodyStart, bodyEnd).replace(/^\s*,\s*/, '').trim()

    // Skip heuristics: if this looks like a type expression, not a value.
    const looksLikeType = /:\s*(string|number|boolean|any|unknown|never|void|\w+\[\]|Array<)/.test(body)
    // Also skip if the literal already uses our target shape (e.g., `val: {...}` already there).
    // We detect this if the body starts with `val:` or contains `as const` in a non-quoted spot.
    const alreadyWrapped = /^\s*val\s*:/.test(body) || /\bas\s+const\b/.test(body)
    if (looksLikeType || alreadyWrapped) {
      out += src.slice(foundIdx, close + 1)
      i = close + 1
      continue
    }

    // Rebuild: if body is empty, val is `{}`; else wrap into val literal.
    const valPart = body.length === 0 ? '{}' : `{ ${body} }`
    out += `{ tag: '${foundTag}', val: ${valPart} }`
    i = close + 1
    changed = true
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 12 — rewrite payload-field access inside `case 'kebab-tag':` blocks.
//
// Within a case branch scrutinizing `block.tag`, `block.<payload-field>`
// needs `.val.` insertion. The set of payload fields per tag is known from
// the WIT definitions. We scan each case body and insert `.val` for the
// correct fields.
// ----------------------------------------------------------------------------
const payloadFieldsByTag = {
  'text': ['text'],
  'tool-use': ['name', 'toolUseId', 'input', 'reasoningSignature'],
  'tool-result': ['toolUseId', 'status', 'content'],
  'reasoning': ['text', 'signature', 'redactedContent'],
  'cache-point': ['cacheType'],
  'guard-content': [], // tagged variant inside, no flat fields
  'json': ['json'],
  'image': ['format', 'source'],
  'video': ['format', 'source'],
  'document': ['format', 'name', 'source'],
  'citations': ['citations'],
}

function rewriteCasePayloadAccess(src) {
  let changed = false
  let out = src

  // For each `case 'tag':` block, find `<id>.<field>` where <id> is the switch
  // scrutinee and <field> is a payload field of that tag.
  // Detection: find `switch (IDENT.tag)` to capture IDENT, then rewrite within
  // that switch block.
  const switchRe = /switch\s*\(\s*([\w$]+)\.tag\s*\)\s*\{/g
  let match
  while ((match = switchRe.exec(out)) !== null) {
    const ident = match[1]
    const blockStart = match.index + match[0].length
    // Walk to matching closing brace of the switch.
    let p = blockStart
    let depth = 1
    while (p < out.length && depth > 0) {
      if (out[p] === '{') depth++
      else if (out[p] === '}') depth--
      if (depth === 0) break
      p++
    }
    if (p >= out.length) continue

    const switchBody = out.slice(blockStart, p)
    // Now walk the switch body and rewrite.
    const newBody = rewriteSwitchBody(switchBody, ident)
    if (newBody !== switchBody) {
      out = out.slice(0, blockStart) + newBody + out.slice(p)
      changed = true
      // Reset regex lastIndex since we mutated out.
      switchRe.lastIndex = blockStart + newBody.length
    }
  }

  return { src: out, changed }
}

function rewriteSwitchBody(body, ident) {
  // Split by `case 'tag':` markers and process each segment with the
  // appropriate tag context. Everything before the first `case` stays.
  const caseRe = /case\s+'([^']+)'\s*:/g
  const segments = []
  let lastIdx = 0
  let lastTag = null
  let m
  while ((m = caseRe.exec(body)) !== null) {
    segments.push({ text: body.slice(lastIdx, m.index), tag: lastTag })
    segments.push({ text: m[0], tag: null }) // the `case 'x':` marker itself
    lastIdx = m.index + m[0].length
    lastTag = m[1]
  }
  segments.push({ text: body.slice(lastIdx), tag: lastTag })

  return segments
    .map((seg) => {
      if (seg.tag === null) return seg.text
      const fields = payloadFieldsByTag[seg.tag]
      if (!fields || fields.length === 0) return seg.text
      let out = seg.text
      for (const field of fields) {
        // Replace `ident.field` with `ident.val.field`, but not `ident.tag`.
        const re = new RegExp(`\\b${ident}\\.${field}\\b`, 'g')
        out = out.replace(re, `${ident}.val.${field}`)
      }
      return out
    })
    .join('')
}

// ----------------------------------------------------------------------------
// Pass 13 — wrap flat-shape payload literals inside arrays that are clearly
// `ContentBlock[]` or similar.
//
// Pattern: object literals whose top-level fields match a known payload
// (e.g. `{ name, toolUseId, input, ... }` → tool-use, `{ text: ... }` → text).
// Wrap as `{ tag: '<tag>', val: {...} }`.
//
// Guardrails: skip if the literal already has `tag`, `type`, or `val` fields.
// Only rewrite when the literal appears as an element (i.e., preceded by `[`
// or `,` and followed by `,` or `]`) — heuristic, not airtight.
// ----------------------------------------------------------------------------

// Signature = the set of required-ish top-level fields that uniquely identify
// a payload kind. Matched by "all required fields present, no disqualifiers".
const payloadSignatures = [
  {
    tag: 'tool-use',
    required: ['name', 'toolUseId', 'input'],
    disqualifiers: ['tag', 'val', 'type', 'status', 'content'],
  },
  {
    tag: 'tool-result',
    required: ['toolUseId', 'status', 'content'],
    disqualifiers: ['tag', 'val', 'type', 'name', 'input'],
  },
  {
    tag: 'cache-point',
    required: ['cacheType'],
    disqualifiers: ['tag', 'val', 'type'],
  },
  // Media: `{ format, source }` is image/video; `{ format, name, source }` is document.
  {
    tag: 'document',
    required: ['format', 'name', 'source'],
    disqualifiers: ['tag', 'val', 'type'],
  },
  // `{ format, source }` → image (default). Can't distinguish from video without more context.
  {
    tag: 'image',
    required: ['format', 'source'],
    onlyTheseFields: true,
    disqualifiers: ['tag', 'val', 'type', 'name'],
  },
  {
    tag: 'citations',
    required: ['citations', 'content'],
    disqualifiers: ['tag', 'val', 'type'],
  },
  // `{ text: ... }` alone is ambiguous (could be text or reasoning). Only
  // wrap when the only field is text — reasoning has signature/redacted too.
  {
    tag: 'text',
    required: ['text'],
    onlyTheseFields: true,
    disqualifiers: ['tag', 'val', 'type', 'signature', 'redactedContent', 'qualifiers'],
  },
]

function parseTopLevelFields(body) {
  // Returns a Set of top-level field names in a JS object-literal body.
  // Walks with brace/paren/bracket depth tracking so nested objects don't
  // contribute their fields.
  const fields = new Set()
  let p = 0
  let depth = 0
  let mode = null
  let escape = false
  let templateDepth = 0
  let atKey = true
  let keyStart = -1

  while (p < body.length) {
    const ch = body[p]
    if (escape) { escape = false; p++; continue }
    if (mode === 'line-comment') { if (ch === '\n') mode = null; p++; continue }
    if (mode === 'block-comment') {
      if (ch === '*' && body[p+1] === '/') { mode = null; p += 2; continue }
      p++; continue
    }
    if (mode === '"' || mode === "'") {
      if (ch === '\\') { escape = true; p++; continue }
      if (ch === mode) mode = null
      p++; continue
    }
    if (mode === 'template') {
      if (ch === '\\') { escape = true; p++; continue }
      if (ch === '`' && templateDepth === 0) { mode = null; p++; continue }
      if (ch === '$' && body[p+1] === '{') { templateDepth++; p += 2; continue }
      if (ch === '}' && templateDepth > 0) { templateDepth--; p++; continue }
      p++; continue
    }
    if (ch === '/' && body[p+1] === '/') { mode = 'line-comment'; p += 2; continue }
    if (ch === '/' && body[p+1] === '*') { mode = 'block-comment'; p += 2; continue }
    if (ch === '"' || ch === "'") { mode = ch; p++; continue }
    if (ch === '`') { mode = 'template'; p++; continue }
    if (ch === '{' || ch === '(' || ch === '[') { depth++; p++; continue }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; p++; continue }
    if (depth !== 0) { p++; continue }

    if (atKey) {
      if (/[\w$]/.test(ch)) {
        if (keyStart === -1) keyStart = p
      } else if (ch === ':' && keyStart !== -1) {
        fields.add(body.slice(keyStart, p).trim())
        keyStart = -1
        atKey = false
      } else if (!/\s/.test(ch) && ch !== ',' && ch !== "'" && ch !== '"' && keyStart !== -1) {
        // might be quoted key, skip
        keyStart = -1
      }
    } else {
      if (ch === ',') { atKey = true; keyStart = -1 }
    }
    p++
  }
  return fields
}

function matchesSignature(fields, sig) {
  for (const r of sig.required) {
    if (!fields.has(r)) return false
  }
  for (const d of sig.disqualifiers ?? []) {
    if (fields.has(d)) return false
  }
  if (sig.onlyTheseFields) {
    for (const f of fields) {
      if (!sig.required.includes(f)) return false
    }
  }
  return true
}

function wrapFlatPayloadLiterals(src) {
  let changed = false
  let out = ''
  let i = 0

  while (i < src.length) {
    const ch = src[i]
    // Only consider `{` preceded by `[` or `,` (array element) or `(`
    // (argument position, e.g. `f({ text: 'x' })`).
    if (ch === '{') {
      // Look back through whitespace for a valid prefix.
      let back = i - 1
      while (back >= 0 && /\s/.test(src[back])) back--
      const prev = back >= 0 ? src[back] : ''
      // Only array-element position (inside `[` or after `,`). Function-arg
      // position `(` is too ambiguous — may want a plain record.
      if (prev === '[' || prev === ',') {
        // Find matching `}`.
        let p = i + 1
        let depth = 1
        let mode = null
        let templateDepth = 0
        let escape = false
        let close = -1
        while (p < src.length) {
          const c2 = src[p]
          if (escape) { escape = false; p++; continue }
          if (mode === 'line-comment') { if (c2 === '\n') mode = null; p++; continue }
          if (mode === 'block-comment') {
            if (c2 === '*' && src[p+1] === '/') { mode = null; p += 2; continue }
            p++; continue
          }
          if (mode === '"' || mode === "'") {
            if (c2 === '\\') { escape = true; p++; continue }
            if (c2 === mode) mode = null
            p++; continue
          }
          if (mode === 'template') {
            if (c2 === '\\') { escape = true; p++; continue }
            if (c2 === '`' && templateDepth === 0) { mode = null; p++; continue }
            if (c2 === '$' && src[p+1] === '{') { templateDepth++; p += 2; continue }
            if (c2 === '}' && templateDepth > 0) { templateDepth--; p++; continue }
            p++; continue
          }
          if (c2 === '/' && src[p+1] === '/') { mode = 'line-comment'; p += 2; continue }
          if (c2 === '/' && src[p+1] === '*') { mode = 'block-comment'; p += 2; continue }
          if (c2 === '"' || c2 === "'") { mode = c2; p++; continue }
          if (c2 === '`') { mode = 'template'; p++; continue }
          if (c2 === '{') { depth++; p++; continue }
          if (c2 === '}') {
            depth--
            if (depth === 0) { close = p; break }
            p++; continue
          }
          p++
        }
        if (close !== -1) {
          const body = src.slice(i + 1, close).trim()
          if (body.length > 0) {
            const fields = parseTopLevelFields(body)
            for (const sig of payloadSignatures) {
              if (matchesSignature(fields, sig)) {
                out += src.slice(i, i + 1) // `{`
                out += ` tag: '${sig.tag}', val: { ${body} } `
                out += '}'
                i = close + 1
                changed = true
                break
              }
            }
            if (i > close) continue // handled
          }
        }
      }
    }
    out += src[i]
    i++
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 14 — wrap media class constructor calls in their tagged variant when
// the call site expects a ContentBlock/ToolResultContent. Same balanced-paren
// strategy as the TextBlock pass.
//
// `new ImageBlock({...})` → `{ tag: 'image', val: new ImageBlock({...}) }`
// Only applies inside array-element context (like pass 13).
// ----------------------------------------------------------------------------
const mediaClassToTag = {
  ImageBlock: 'image',
  VideoBlock: 'video',
  DocumentBlock: 'document',
  CitationsBlock: 'citations',
}

function wrapMediaCtorCalls(src) {
  let changed = false
  let out = ''
  let i = 0

  while (i < src.length) {
    // Look for `new X(` where X is a media class.
    let matchIdx = -1
    let matchCls = null
    for (const cls of Object.keys(mediaClassToTag)) {
      const needle = `new ${cls}(`
      const idx = src.indexOf(needle, i)
      if (idx !== -1 && (matchIdx === -1 || idx < matchIdx)) {
        matchIdx = idx
        matchCls = cls
      }
    }
    if (matchIdx === -1) {
      out += src.slice(i)
      break
    }

    // Check context: only wrap if in array-element position.
    let back = matchIdx - 1
    while (back >= 0 && /\s/.test(src[back])) back--
    const prev = back >= 0 ? src[back] : ''
    // Array element or return/push/case: approximate by `[`, `,`, `return `.
    // Also watch for `=> new X(` (arrow-returned value, callers vary).
    const isArrayElem = prev === '[' || prev === ','
    // Check if preceded by `return ` — narrow but captures direct returns.
    const precedingLine = src.slice(Math.max(0, matchIdx - 40), matchIdx)
    const isReturn = /\breturn\s*$/.test(precedingLine)
    // Check `=> new X(` and `push(new X(`
    const isArrow = /=>\s*$/.test(precedingLine)
    const isPushArg = /\bpush\s*\(\s*$/.test(precedingLine)

    if (!isArrayElem && !isReturn && !isArrow && !isPushArg) {
      out += src.slice(i, matchIdx + 1)
      i = matchIdx + 1
      continue
    }

    // Walk to matching `)` of the ctor call.
    const needle = `new ${matchCls}(`
    let p = matchIdx + needle.length
    let depth = 1
    let mode = null
    let templateDepth = 0
    let escape = false
    let close = -1
    while (p < src.length) {
      const ch = src[p]
      if (escape) { escape = false; p++; continue }
      if (mode === 'line-comment') { if (ch === '\n') mode = null; p++; continue }
      if (mode === 'block-comment') {
        if (ch === '*' && src[p+1] === '/') { mode = null; p += 2; continue }
        p++; continue
      }
      if (mode === '"' || mode === "'") {
        if (ch === '\\') { escape = true; p++; continue }
        if (ch === mode) mode = null
        p++; continue
      }
      if (mode === 'template') {
        if (ch === '\\') { escape = true; p++; continue }
        if (ch === '`' && templateDepth === 0) { mode = null; p++; continue }
        if (ch === '$' && src[p+1] === '{') { templateDepth++; p += 2; continue }
        if (ch === '}' && templateDepth > 0) { templateDepth--; p++; continue }
        p++; continue
      }
      if (ch === '/' && src[p+1] === '/') { mode = 'line-comment'; p += 2; continue }
      if (ch === '/' && src[p+1] === '*') { mode = 'block-comment'; p += 2; continue }
      if (ch === '"' || ch === "'") { mode = ch; p++; continue }
      if (ch === '`') { mode = 'template'; p++; continue }
      if (ch === '(') { depth++; p++; continue }
      if (ch === ')') {
        depth--
        if (depth === 0) { close = p; break }
        p++; continue
      }
      p++
    }
    if (close === -1) {
      out += src.slice(i)
      break
    }

    const tag = mediaClassToTag[matchCls]
    const ctorExpr = src.slice(matchIdx, close + 1)
    const wrapped = `{ tag: '${tag}', val: ${ctorExpr} }`
    // Arrow bodies must be parenthesized so the literal parses as an expression.
    out += src.slice(i, matchIdx) + (isArrow ? `(${wrapped})` : wrapped)
    i = close + 1
    changed = true
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 15 — rewrite source-variant discriminator accesses:
//   `x.source.type === 'imageSourceBytes'` → `x.source.tag === 'bytes'`
//   `x.source.type === 'imageSourceUrl'`   → `x.source.tag === 'url'`
//   `x.source.type === 'imageSourceS3Location'` → `x.source.tag === 's3-location'`
// (and video/document variants). Followed by payload-field rewrites:
//   `x.source.bytes` → `x.source.val`
//   `x.source.url`   → `x.source.val`
//   `x.source.location` → `x.source.val`
// Scoped to appear inside a block where the tag has been narrowed, which
// we can't determine cheaply. Use a heuristic: if a line has both
// `.source.type === 'xSourceY'` and subsequent `.source.<field>`, rewrite.
// For a simpler first pass, apply the tag rename globally — it's distinctive.
// ----------------------------------------------------------------------------
const sourceTagRenames = [
  ['imageSourceBytes', 'bytes'],
  ['imageSourceUrl', 'url'],
  ['imageSourceS3Location', 's3-location'],
  ['videoSourceBytes', 'bytes'],
  ['videoSourceS3Location', 's3-location'],
  ['documentSourceBytes', 'bytes'],
  ['documentSourceContent', 'content'],
  ['documentSourceS3Location', 's3-location'],
]

function renameSourceTags(src) {
  let changed = false
  let out = src
  for (const [camel, kebab] of sourceTagRenames) {
    const patterns = [
      [new RegExp(`(\\.source\\.)type(\\s*(?:===|!==)\\s*)'${camel}'`, 'g'), `$1tag$2'${kebab}'`],
      [new RegExp(`(case\\s+)'${camel}'`, 'g'), `$1'${kebab}'`],
    ]
    for (const [re, rep] of patterns) {
      if (re.test(out)) {
        out = out.replace(re, rep)
        changed = true
      }
    }
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 16 — `.source.type` in switch head → `.source.tag`
// ----------------------------------------------------------------------------
function renameSourceSwitch(src) {
  const re = /switch\s*\(\s*([^)]+?)\.source\.type\s*\)/g
  if (!re.test(src)) return { src, changed: false }
  return { src: src.replace(re, 'switch ($1.source.tag)'), changed: true }
}

// ----------------------------------------------------------------------------
// Pass 17 — drop `.toJSON()` method calls. Records are plain objects; the
// record IS the serialized form. `msg.toJSON().foo` → `msg.foo`.
// ----------------------------------------------------------------------------
function dropToJSON(src) {
  const re = /\.toJSON\(\)/g
  if (!re.test(src)) return { src, changed: false }
  return { src: src.replace(re, ''), changed: true }
}

// ----------------------------------------------------------------------------
// Pass 18 — replace `BlockClass.fromJSON(data)` (test round-trip pattern)
// with the raw data since records don't need constructors.
// ----------------------------------------------------------------------------
function dropClassFromJSON(src) {
  const classes = Object.keys(tagFor).join('|')
  const re = new RegExp(`\\b(?:${classes})\\.fromJSON\\(([^)]+)\\)`, 'g')
  if (!re.test(src)) return { src, changed: false }
  return { src: src.replace(re, '$1'), changed: true }
}

// ----------------------------------------------------------------------------
// Pass 19 — within blocks guarded by `.source.tag === 'X'`, rewrite
// `.source.<payload-field>` → `.source.val`.
//
// Detection: find an `if (... .source.tag === 'bytes' ...)` block, then in
// its body rewrite `<scrutinee>.source.bytes` (or matching field) to `.val`.
// ----------------------------------------------------------------------------
const sourcePayloadFields = {
  'bytes': 'bytes',
  'url': 'url',
  's3-location': 'location',
  'content': 'content',
}

function rewriteNarrowedSourceAccess(src) {
  let changed = false
  let out = src
  // Simpler (and broader): once tag has been renamed, `.source.bytes`,
  // `.source.url`, `.source.location` are no longer valid because the
  // payload lives in `.val`. Rewrite these access patterns globally within
  // any file that has `.source.tag`.
  if (/\.source\.tag\b/.test(out)) {
    const before = out
    out = out.replace(/\.source\.bytes\b/g, '.source.val')
    out = out.replace(/\.source\.url\b/g, '.source.val')
    out = out.replace(/\.source\.location\b/g, '.source.val')
    if (out !== before) changed = true
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 20 — wrap raw source literals in tagged variants.
//   `source: { bytes: X }`    → `source: { tag: 'bytes', val: X }`
//   `source: { url: 'u' }`    → `source: { tag: 'url', val: 'u' }`
//   `source: { location: X }` → `source: { tag: 's3-location', val: X }`
//   `source: { text: 'x' }`   → `source: { tag: 'content', val: [{tag:'text', val:{text:'x'}}] }`
//
// Only single-field object literals to avoid collisions.
// ----------------------------------------------------------------------------
function wrapRawSourceLiterals(src) {
  let changed = false
  let out = src
  // bytes
  out = out.replace(/source:\s*\{\s*bytes:\s*([^}]+?)\s*\}/g, (m, expr) => {
    changed = true
    return `source: { tag: 'bytes', val: ${expr.trim()} }`
  })
  // url
  out = out.replace(/source:\s*\{\s*url:\s*([^}]+?)\s*\}/g, (m, expr) => {
    changed = true
    return `source: { tag: 'url', val: ${expr.trim()} }`
  })
  // location (old name for s3-location)
  out = out.replace(/source:\s*\{\s*location:\s*([^}]+?)\s*\}/g, (m, expr) => {
    changed = true
    return `source: { tag: 's3-location', val: ${expr.trim()} }`
  })
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 21 — convert raw JSON `input: {...}` into JSON-encoded string.
// WIT `tool-use-block.input` is `string` (JSON-encoded).
// Matches `input: {...}` and `input: [...]` within tool-use contexts.
// Heuristic: only rewrite when preceded by `name:` or `toolUseId:` (strong
// tool-use-block signal).
// ----------------------------------------------------------------------------
function encodeToolUseInput(src) {
  let changed = false
  let out = ''
  let i = 0
  while (i < src.length) {
    // Find `input:` after a name:/toolUseId: hint within N chars.
    const idx = src.indexOf('input:', i)
    if (idx === -1) {
      out += src.slice(i)
      break
    }
    // Check backwards for a tool-use signal within the last ~120 chars.
    const backSlice = src.slice(Math.max(0, idx - 120), idx)
    const isToolUse = /name:\s*'[^']+'\s*,\s*(?:toolUseId:|[^,}]+,\s*toolUseId:)/.test(backSlice) ||
                      /toolUseId:\s*'[^']+'/.test(backSlice)
    if (!isToolUse) {
      out += src.slice(i, idx + 6)
      i = idx + 6
      continue
    }

    // Find the value after `input:`. Skip whitespace.
    let p = idx + 6
    while (p < src.length && /\s/.test(src[p])) p++
    if (src[p] !== '{' && src[p] !== '[') {
      out += src.slice(i, idx + 6)
      i = idx + 6
      continue
    }
    const openCh = src[p]
    const closeCh = openCh === '{' ? '}' : ']'
    // Walk to matching close with mode tracking.
    let q = p + 1
    let depth = 1
    let mode = null
    let templateDepth = 0
    let escape = false
    let end = -1
    while (q < src.length) {
      const ch = src[q]
      if (escape) { escape = false; q++; continue }
      if (mode === '"' || mode === "'") {
        if (ch === '\\') { escape = true; q++; continue }
        if (ch === mode) mode = null
        q++; continue
      }
      if (mode === 'template') {
        if (ch === '\\') { escape = true; q++; continue }
        if (ch === '`' && templateDepth === 0) { mode = null; q++; continue }
        if (ch === '$' && src[q+1] === '{') { templateDepth++; q += 2; continue }
        if (ch === '}' && templateDepth > 0) { templateDepth--; q++; continue }
        q++; continue
      }
      if (ch === '"' || ch === "'") { mode = ch; q++; continue }
      if (ch === '`') { mode = 'template'; q++; continue }
      if (ch === openCh) { depth++; q++; continue }
      if (ch === closeCh) {
        depth--
        if (depth === 0) { end = q; break }
        q++; continue
      }
      q++
    }
    if (end === -1) {
      out += src.slice(i)
      break
    }
    const jsonBody = src.slice(p, end + 1)
    // Skip if template strings or spread expressions are present.
    const hasTemplate = /`|\.\.\./.test(jsonBody)
    if (hasTemplate) {
      out += src.slice(i, p)
      i = p
      continue
    }
    // Try to normalize single quotes to JSON, quote unquoted keys.
    try {
      let normalized = jsonBody.replace(/'([^']*)'/g, '"$1"')
      // Quote unquoted keys: { key: ... } → { "key": ... }
      normalized = normalized.replace(/([{,]\s*)([a-zA-Z_$][\w$]*)\s*:/g, '$1"$2":')
      const parsed = JSON.parse(normalized)
      const encoded = JSON.stringify(JSON.stringify(parsed))
      out += src.slice(i, p) + encoded
      i = end + 1
      changed = true
    } catch {
      out += src.slice(i, p)
      i = p
    }
  }
  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 22 — inline tag narrowing via `&&`:
//   `x.tag === 'text' && x.text` → `x.tag === 'text' && x.val.text`
//
// Same for all single-payload tags. Applied only when the scrutinee on both
// sides is the same identifier, and the accessed field is a valid payload
// field of the asserted tag.
// ----------------------------------------------------------------------------
function rewriteInlineNarrowing(src) {
  let changed = false
  let out = src

  for (const [tag, fields] of Object.entries(payloadFieldsByTag)) {
    if (!fields || fields.length === 0) continue
    for (const field of fields) {
      // Match: IDENT.tag === 'tag' && IDENT.field
      const re = new RegExp(
        `([\\w$]+)\\.tag\\s*===\\s*'${tag}'\\s*&&\\s*\\1\\.${field}\\b`,
        'g'
      )
      if (re.test(out)) {
        out = out.replace(re, (m, ident) => `${ident}.tag === '${tag}' && ${ident}.val.${field}`)
        changed = true
      }
    }
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 23 — rewrite `(x as Block).<field>` → `(x as { val: Block }).val.<field>`
//
// When casting to a WIT record and accessing a payload field, the cast is
// off by one level (tagged union wrapper). This pass inserts the `val.` access.
// Only applied when the accessed field is a valid payload field of the class.
// ----------------------------------------------------------------------------
function rewriteCastPayloadAccess(src) {
  let changed = false
  let out = src

  for (const [cls, tag] of Object.entries(tagFor)) {
    const fields = payloadFieldsByTag[tag]
    if (!fields) continue
    for (const field of fields) {
      // `(X as cls).field` → `(X as { val: cls }).val.field`
      const re = new RegExp(`\\(\\s*([^)]+?)\\s+as\\s+${cls}\\s*\\)\\.${field}\\b`, 'g')
      if (re.test(out)) {
        out = out.replace(re, `($1 as { val: ${cls} }).val.${field}`)
        changed = true
      }
    }
  }

  // `(X as ContentBlock).type` → `(X as ContentBlock).tag` (and ToolResultContent,
  // SystemContentBlock). Same for bare `contentBlock.type` where contentBlock
  // variable is typed ContentBlock.
  const typeAccessRe = /\(\s*([^)]+?)\s+as\s+(ContentBlock|ToolResultContent|SystemContentBlock|PlainContentBlock|PlainSystemContentBlock)\s*\)\.type\b/g
  if (typeAccessRe.test(out)) {
    out = out.replace(typeAccessRe, '($1 as $2).tag')
    changed = true
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Pass 24 — assertion patterns: `.type).toBe('textBlock')` → `.tag).toBe('text')`
// Broad because we only match when RHS is a kebab-renaming target.
// ----------------------------------------------------------------------------
function rewriteTypeAssertions(src) {
  let changed = false
  let out = src

  for (const [camel, kebab] of blockTagRenames) {
    // `.type).toBe('textBlock')` or `.type).toEqual('textBlock')`
    const re = new RegExp(
      `\\.type(\\s*\\)\\.to(?:Be|Equal|StrictEqual)\\s*\\(\\s*)'${camel}'`,
      'g'
    )
    if (re.test(out)) {
      out = out.replace(re, `.tag$1'${kebab}'`)
      changed = true
    }
  }

  return { src: out, changed }
}

// ----------------------------------------------------------------------------
// Driver
// ----------------------------------------------------------------------------
rewriteIndexTs()
rewriteMessagesTs()
rewriteMediaTs()
rewriteCitationsTs()
rewriteSlimTypes()

const files = listFiles(srcDir)
let totalChanges = 0

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8')
  let fileChanged = false

  // Wrap TextBlock first (before strip, since TextBlock wrap inserts braces)
  const t = wrapTextBlock(src)
  if (t.changed) {
    src = t.src
    fileChanged = true
  }

  // Strip class constructors. All of these are now WIT records.
  for (const cls of [
    'ToolResultBlock',
    'ToolUseBlock',
    'ReasoningBlock',
    'CachePointBlock',
    'ImageBlock',
    'VideoBlock',
    'DocumentBlock',
    'CitationsBlock',
    'S3Location',
    'JsonBlock',
    'GuardContentBlock',
  ]) {
    const s = stripConstructor(src, cls)
    if (s.changed) {
      src = s.src
      fileChanged = true
    }
  }

  // instanceof / toBeInstanceOf → discriminator checks
  const inst = replaceInstanceChecks(src)
  if (inst.changed) {
    src = inst.src
    fileChanged = true
  }

  // Type-only import fixes
  const imp = fixTypeOnlyImports(src)
  if (imp.changed) {
    src = imp.src
    fileChanged = true
  }

  // StopReason kebab-case rename
  const sr = renameStopReasons(src)
  if (sr.changed) {
    src = sr.src
    fileChanged = true
  }

  // Block discriminator tag rename
  const bt = renameBlockTags(src)
  if (bt.changed) {
    src = bt.src
    fileChanged = true
  }

  // Data-alias collapse
  const da = renameDataAliases(src)
  if (da.changed) {
    src = da.src
    fileChanged = true
  }

  // Drop serialization helpers
  const ds = dropSerializationHelpers(src)
  if (ds.changed) {
    src = ds.src
    fileChanged = true
  }

  // Dedup imports (cleans up after `Data`-alias collapse)
  const di = dedupImports(src)
  if (di.changed) {
    src = di.src
    fileChanged = true
  }

  // Raw literal `{ type: 'textBlock', text: ... }` → `{ tag: 'text', val: {...} }`
  const rbl = rewriteRawBlockLiterals(src)
  if (rbl.changed) {
    src = rbl.src
    fileChanged = true
  }

  // Within `case 'tag':` bodies, insert `.val.` for payload field accesses.
  const cpa = rewriteCasePayloadAccess(src)
  if (cpa.changed) {
    src = cpa.src
    fileChanged = true
  }

  // Wrap flat payload literals (those without `tag` or `type` field).
  const wf = wrapFlatPayloadLiterals(src)
  if (wf.changed) {
    src = wf.src
    fileChanged = true
  }

  // Pass 14 (wrapMediaCtorCalls) removed: media classes are now stripped to
  // records by stripConstructor, and pass 13 (wrapFlatPayloadLiterals) wraps
  // them in tagged variants by signature.

  // Source variant discriminator rewrites
  const st = renameSourceTags(src)
  if (st.changed) {
    src = st.src
    fileChanged = true
  }
  const ss = renameSourceSwitch(src)
  if (ss.changed) {
    src = ss.src
    fileChanged = true
  }

  // Drop dead `.toJSON()` and `X.fromJSON(...)` calls.
  const tj = dropToJSON(src)
  if (tj.changed) {
    src = tj.src
    fileChanged = true
  }
  const cfj = dropClassFromJSON(src)
  if (cfj.changed) {
    src = cfj.src
    fileChanged = true
  }

  // Narrowed-source access rewrites
  const ns = rewriteNarrowedSourceAccess(src)
  if (ns.changed) {
    src = ns.src
    fileChanged = true
  }

  // Wrap raw source literals in tagged variants
  const wrs = wrapRawSourceLiterals(src)
  if (wrs.changed) {
    src = wrs.src
    fileChanged = true
  }

  // Encode tool-use input JSON literal to string
  const tui = encodeToolUseInput(src)
  if (tui.changed) {
    src = tui.src
    fileChanged = true
  }

  // Inline `&&` narrowing rewrites
  const in2 = rewriteInlineNarrowing(src)
  if (in2.changed) {
    src = in2.src
    fileChanged = true
  }

  // Cast-based payload access rewrites
  const cpa2 = rewriteCastPayloadAccess(src)
  if (cpa2.changed) {
    src = cpa2.src
    fileChanged = true
  }

  // `.type).toBe('textBlock')` → `.tag).toBe('text')`
  const tr = rewriteTypeAssertions(src)
  if (tr.changed) {
    src = tr.src
    fileChanged = true
  }

  if (fileChanged) {
    fs.writeFileSync(file, src)
    totalChanges++
  }
}

console.error(`migration: rewrote messages.ts; modified ${totalChanges} source files`)
