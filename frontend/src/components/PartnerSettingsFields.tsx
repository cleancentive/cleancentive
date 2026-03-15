import { useState } from 'react'
import { useTeamStore } from '../stores/teamStore'
import { useConnectivityStore } from '../stores/connectivityStore'

interface Props {
  patterns: string
  onPatternsChange: (v: string) => void
  customCss: string
  onCustomCssChange: (v: string) => void
}

function generateCss(colors: { primary: string | null; accent: string | null }, faviconUrl: string | null): string {
  const lines: string[] = [':root {']
  if (colors.primary) lines.push(`  --partner-primary: ${colors.primary};`)
  if (colors.accent) lines.push(`  --partner-accent: ${colors.accent};`)
  if (faviconUrl) lines.push(`  --partner-favicon-url: url('${faviconUrl}');`)
  lines.push('}')
  return lines.join('\n')
}

export function PartnerSettingsFields({ patterns, onPatternsChange, customCss, onCustomCssChange }: Props) {
  const { importPartnerUrl } = useTeamStore()
  const { isOnline } = useConnectivityStore()
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)

  const handleImport = async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    const result = await importPartnerUrl(importUrl.trim())
    setImporting(false)
    if (result) {
      onPatternsChange(result.domain)
      onCustomCssChange(generateCss(result.colors, result.favicon_url))
    }
  }

  return (
    <>
      <div className="form-group">
        <label>Import from URL</label>
        <div className="import-url-row">
          <input
            type="url"
            className="full-width"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://www.baloise.ch/"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleImport() } }}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={!isOnline || importing || !importUrl.trim()}
            onClick={handleImport}
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
        <small>Enter a company website to auto-detect email domain, colors, and favicon.</small>
      </div>

      <div className="form-group">
        <label htmlFor="email-patterns">Email Patterns (one per line)</label>
        <textarea
          id="email-patterns"
          className="full-width"
          value={patterns}
          onChange={(e) => onPatternsChange(e.target.value)}
          placeholder={'helvetia.com\n(helvetia|baloise).ch\nadmin_.*@cleancentive\\..*'}
          rows={5}
        />
        <small>Plain domains (e.g. <code>helvetia.com</code>) or regex patterns. Leave empty for a regular team.</small>
      </div>

      <div className="form-group">
        <label htmlFor="custom-css">Custom CSS</label>
        <textarea
          id="custom-css"
          className="full-width mono"
          value={customCss}
          onChange={(e) => onCustomCssChange(e.target.value)}
          placeholder={`:root {\n  --partner-primary: #1d4ed8;\n  --partner-accent: #3b82f6;\n  --partner-favicon-url: url('/favicon-partner.ico');\n}`}
          rows={10}
        />
      </div>
    </>
  )
}
