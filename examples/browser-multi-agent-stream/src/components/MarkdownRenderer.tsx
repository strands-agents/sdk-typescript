import React from 'react'

interface MarkdownRendererProps {
  text: string
  className?: string
}

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; language?: string; text: string }

function isUnorderedListLine(line: string): boolean {
  return /^[-*]\s+/.test(line)
}

function isOrderedListLine(line: string): boolean {
  return /^\d+\.\s+/.test(line)
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^```/.test(line) ||
    isUnorderedListLine(line) ||
    isOrderedListLine(line)
  )
}

function parseBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i] ?? ''
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      i += 1
      continue
    }

    if (line.startsWith('```')) {
      const language = line.slice(3).trim() || undefined
      i += 1
      const codeLines: string[] = []
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        codeLines.push(lines[i] ?? '')
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', language, text: codeLines.join('\n') })
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2] ?? '',
      })
      i += 1
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (i < lines.length) {
        const current = (lines[i] ?? '').trimEnd()
        if (!/^>\s?/.test(current)) break
        quoteLines.push(current.replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push({ type: 'blockquote', text: quoteLines.join('\n') })
      continue
    }

    if (isUnorderedListLine(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const current = (lines[i] ?? '').trimEnd()
        if (!isUnorderedListLine(current)) break
        items.push(current.replace(/^[-*]\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'unordered-list', items })
      continue
    }

    if (isOrderedListLine(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const current = (lines[i] ?? '').trimEnd()
        if (!isOrderedListLine(current)) break
        items.push(current.replace(/^\d+\.\s+/, ''))
        i += 1
      }
      blocks.push({ type: 'ordered-list', items })
      continue
    }

    const paragraphLines: string[] = []
    while (i < lines.length) {
      const current = (lines[i] ?? '').trimEnd()
      if (current.trim() === '') {
        i += 1
        break
      }
      if (isBlockStart(current)) break
      paragraphLines.push(current)
      i += 1
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g)
  const out: React.ReactNode[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? ''
    const key = `${keyPrefix}-${i}`
    if (token === '') continue
    if (/^\*\*[^*]+\*\*$/.test(token)) {
      out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
      continue
    }
    if (/^\*[^*]+\*$/.test(token)) {
      out.push(<em key={key}>{token.slice(1, -1)}</em>)
      continue
    }
    if (/^`[^`]+`$/.test(token)) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>)
      continue
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
    if (linkMatch) {
      out.push(
        <a key={key} href={linkMatch[2]} target="_blank" rel="noreferrer">
          {linkMatch[1]}
        </a>
      )
      continue
    }

    const lines = token.split('\n')
    for (let j = 0; j < lines.length; j += 1) {
      const line = lines[j] ?? ''
      out.push(<React.Fragment key={`${key}-line-${j}`}>{line}</React.Fragment>)
      if (j < lines.length - 1) out.push(<br key={`${key}-br-${j}`} />)
    }
  }

  return out
}

export default function MarkdownRenderer({
  text,
  className,
}: MarkdownRendererProps): JSX.Element {
  const blocks = React.useMemo(() => parseBlocks(text), [text])

  return (
    <div className={className ? `markdown-content ${className}` : 'markdown-content'}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const level = Math.min(6, Math.max(1, block.level))
          const Tag = `h${level}` as keyof JSX.IntrinsicElements
          return <Tag key={`h-${index}`}>{renderInline(block.text, `h-${index}`)}</Tag>
        }
        if (block.type === 'code') {
          return (
            <pre key={`code-${index}`}>
              <code className={block.language ? `language-${block.language}` : undefined}>
                {block.text}
              </code>
            </pre>
          )
        }
        if (block.type === 'blockquote') {
          return <blockquote key={`quote-${index}`}>{renderInline(block.text, `q-${index}`)}</blockquote>
        }
        if (block.type === 'unordered-list') {
          return (
            <ul key={`ul-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`ul-${index}-${itemIndex}`}>{renderInline(item, `uli-${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          )
        }
        if (block.type === 'ordered-list') {
          return (
            <ol key={`ol-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li key={`ol-${index}-${itemIndex}`}>{renderInline(item, `oli-${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          )
        }
        return <p key={`p-${index}`}>{renderInline(block.text, `p-${index}`)}</p>
      })}
    </div>
  )
}
