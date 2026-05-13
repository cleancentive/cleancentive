import { useCallback, useState } from 'react'

export interface SelectableDate {
  id: string
  start_at: string
  recurrence_id: string | null
}

export interface UseCleanupSelection<D extends SelectableDate> {
  selectedDateIds: Set<string>
  toggleSelect: (dateId: string) => void
  toggleRecurrenceGroup: (dateId: string) => void
  selectRelated: () => void
  selectAllAfter: () => void
  clearSelection: () => void
  hasSelectedWithRecurrence: boolean
  earliestSelected: D | null
}

export function useCleanupSelection<D extends SelectableDate>(dates: D[]): UseCleanupSelection<D> {
  const [selectedDateIds, setSelectedDateIds] = useState<Set<string>>(new Set())

  const toggleSelect = useCallback((dateId: string) => {
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      if (next.has(dateId)) next.delete(dateId)
      else next.add(dateId)
      return next
    })
  }, [])

  const toggleRecurrenceGroup = useCallback((dateId: string) => {
    const target = dates.find((d) => d.id === dateId)
    if (!target) return
    if (!target.recurrence_id) {
      toggleSelect(dateId)
      return
    }
    const relatedIds = dates.filter((x) => x.recurrence_id === target.recurrence_id).map((x) => x.id)
    setSelectedDateIds((prev) => {
      const allSelected = relatedIds.every((rid) => prev.has(rid))
      const next = new Set(prev)
      for (const rid of relatedIds) {
        if (allSelected) next.delete(rid)
        else next.add(rid)
      }
      return next
    })
  }, [dates, toggleSelect])

  const selectRelated = useCallback(() => {
    const selectedRecurrenceIds = new Set(
      dates.filter((d) => selectedDateIds.has(d.id) && d.recurrence_id).map((d) => d.recurrence_id!),
    )
    if (selectedRecurrenceIds.size === 0) return
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      for (const d of dates) {
        if (d.recurrence_id && selectedRecurrenceIds.has(d.recurrence_id)) next.add(d.id)
      }
      return next
    })
  }, [dates, selectedDateIds])

  const selectAllAfter = useCallback(() => {
    const selectedDates = dates.filter((d) => selectedDateIds.has(d.id))
    if (selectedDates.length === 0) return
    const earliest = selectedDates.reduce((a, b) => (a.start_at < b.start_at ? a : b))
    setSelectedDateIds((prev) => {
      const next = new Set(prev)
      for (const d of dates) {
        if (d.start_at >= earliest.start_at) next.add(d.id)
      }
      return next
    })
  }, [dates, selectedDateIds])

  const clearSelection = useCallback(() => {
    setSelectedDateIds(new Set())
  }, [])

  const hasSelectedWithRecurrence = dates.some((d) => selectedDateIds.has(d.id) && d.recurrence_id !== null)
  const earliestSelected = selectedDateIds.size > 0 && dates.length > 0
    ? dates.filter((d) => selectedDateIds.has(d.id)).reduce((a, b) => (a.start_at < b.start_at ? a : b), dates[0])
    : null

  return {
    selectedDateIds,
    toggleSelect,
    toggleRecurrenceGroup,
    selectRelated,
    selectAllAfter,
    clearSelection,
    hasSelectedWithRecurrence,
    earliestSelected,
  }
}
