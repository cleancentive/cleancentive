import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { BASEMAP_THEMES, type BasemapTheme } from '../config/basemaps'
import { useBasemapStore } from '../stores/basemapStore'

function LayersIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5-9 5-9-5 9-5z" />
      <path d="M3 13l9 5 9-5" />
      <path d="M3 18l9 5 9-5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  )
}

function Row({
  theme,
  selected,
  onSelect,
}: {
  theme: { id: BasemapTheme; label: string }
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation(['map', 'common'])
  return (
    <button
      type="button"
      className={`basemap-row${selected ? ' basemap-row--selected' : ''}`}
      onClick={onSelect}
    >
      <span className="basemap-row-label">{t(`basemap.themes.${theme.id}`, theme.label)}</span>
      {selected && <span className="basemap-row-check" aria-hidden>✓</span>}
    </button>
  )
}

interface BasemapSwitcherProps {
  // When provided, the trigger button is portaled into this slot — used so the
  // map page can mount the button inside MapLibre's native control stack.
  // null means the slot isn't ready yet (suppress rendering); undefined means
  // render the trigger inline (legacy / standalone usage).
  triggerSlot?: HTMLElement | null
}

export function BasemapSwitcher({ triggerSlot }: BasemapSwitcherProps = {}) {
  const { t } = useTranslation(['map', 'common'])
  const [open, setOpen] = useState(false)
  const selectedTheme = useBasemapStore((s) => s.selectedTheme)
  const setSelectedTheme = useBasemapStore((s) => s.setSelectedTheme)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointer(e: PointerEvent) {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  function handleSelect(theme: BasemapTheme) {
    setSelectedTheme(theme)
    setOpen(false)
  }

  const trigger = (
    <button
      type="button"
      className="basemap-trigger maplibregl-ctrl-icon"
      aria-label={t('basemap.switch')}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation()
        setOpen((v) => !v)
      }}
    >
      <LayersIcon />
    </button>
  )

  return (
    <>
      {triggerSlot === undefined ? trigger : (triggerSlot && createPortal(trigger, triggerSlot))}

      {open && (
        <div className="basemap-sheet-backdrop" role="dialog" aria-label={t('basemap.options')}>
          <div className="basemap-sheet" ref={sheetRef}>
            <div className="basemap-sheet-header">
              <span className="basemap-sheet-title">{t('basemap.style')}</span>
              <button
                type="button"
                className="basemap-sheet-close"
                aria-label={t('common:actions.close')}
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="basemap-section-label">{t('basemap.themesLabel')}</div>
            <div className="basemap-list">
              {BASEMAP_THEMES.map((theme) => (
                <Row
                  key={theme.id}
                  theme={theme}
                  selected={theme.id === selectedTheme}
                  onSelect={() => handleSelect(theme.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
