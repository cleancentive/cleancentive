import { useEffect, useRef, useState } from 'react'

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
  return (
    <button
      type="button"
      className={`basemap-row${selected ? ' basemap-row--selected' : ''}`}
      onClick={onSelect}
    >
      <span className="basemap-row-label">{theme.label}</span>
      {selected && <span className="basemap-row-check" aria-hidden>✓</span>}
    </button>
  )
}

export function BasemapSwitcher() {
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

  return (
    <>
      <button
        type="button"
        className="basemap-trigger"
        aria-label="Switch basemap"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <LayersIcon />
      </button>

      {open && (
        <div className="basemap-sheet-backdrop" role="dialog" aria-label="Basemap options">
          <div className="basemap-sheet" ref={sheetRef}>
            <div className="basemap-sheet-header">
              <span className="basemap-sheet-title">Map style</span>
              <button
                type="button"
                className="basemap-sheet-close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="basemap-section-label">Themes</div>
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
