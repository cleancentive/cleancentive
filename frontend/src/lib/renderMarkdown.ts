import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Descriptions are written by users and imported from other people's websites,
// so the rendered output is whitelisted rather than merely "cleaned": no script,
// no iframe, no images, no event handlers, and links may only be http(s) or
// mailto. Everything outside this list comes out as inert text.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote', 'h3', 'h4', 'h5', 'hr']
const ALLOWED_ATTR = ['href', 'title']
const ALLOWED_URI_REGEXP = /^(https?:|mailto:)/i

marked.use({ breaks: true, gfm: true })

let hookInstalled = false

function installLinkHook(): void {
  if (hookInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer ugc')
    }
  })
  hookInstalled = true
}

/**
 * Markdown to sanitized HTML. `breaks: true` keeps single newlines meaningful,
 * which every description written before Markdown relied on.
 */
export function renderMarkdown(source: string): string {
  installLinkHook()
  const html = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP })
}
