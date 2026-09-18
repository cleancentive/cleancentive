import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownText } from './MarkdownText'

interface MarkdownEditorProps {
  id?: string
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
}

/**
 * Markdown in a textarea, with a preview that is the very same renderer the
 * saved description goes through — so what is previewed is what appears.
 */
export function MarkdownEditor({ id, value, onChange, rows = 10, placeholder }: MarkdownEditorProps) {
  const { t } = useTranslation(['common'])
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  return (
    <div className="markdown-editor">
      <div className="markdown-editor-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          className={tab === 'write' ? 'active' : ''}
          onClick={() => setTab('write')}
        >
          {t('common:markdown.write')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={tab === 'preview' ? 'active' : ''}
          onClick={() => setTab('preview')}
        >
          {t('common:markdown.preview')}
        </button>
        <a
          className="markdown-editor-help"
          href="https://www.markdownguide.org/basic-syntax/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('common:markdown.supported')}
        </a>
      </div>
      {tab === 'write' ? (
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={rows} placeholder={placeholder} />
      ) : value.trim() ? (
        <MarkdownText source={value} className="markdown-editor-preview" />
      ) : (
        <p className="markdown-editor-empty">{t('common:markdown.nothingToPreview')}</p>
      )}
    </div>
  )
}
