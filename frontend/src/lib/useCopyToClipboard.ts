import { useCallback, useRef, useState, useEffect } from 'react'

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

export function useCopyToClipboard(resetMs = 2000) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
  }, [])

  const markCopied = useCallback((text: string) => {
    setCopiedValue(text)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setCopiedValue((current) => (current === text ? null : current))
    }, resetMs)
  }, [resetMs])

  const copy = useCallback(async (text: string): Promise<boolean> => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        markCopied(text)
        return true
      } catch {
        // Fall through to legacy path.
      }
    }
    if (legacyCopy(text)) {
      markCopied(text)
      return true
    }
    setCopiedValue(null)
    return false
  }, [markCopied])

  return { copied: copiedValue !== null, copiedValue, copy }
}
