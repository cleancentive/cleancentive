import { useMemo } from 'react'
import { renderMarkdown } from '../lib/renderMarkdown'

/**
 * Renders a Markdown description. Plain text stays plain text — descriptions
 * written before Markdown render exactly as they did.
 */
export function MarkdownText({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
