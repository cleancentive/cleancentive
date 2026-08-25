import { useState } from 'react'
import {
  type Frequency,
  defaultStartFor,
  defaultEndFrom,
  durationHours,
  generateRecurringDates,
  generateRecurringDatesUntil,
  MAX_OCCURRENCES,
} from '../lib/cleanupDates'
import { isoToDatetimeLocal } from '../utils/datetime'

export interface CleanupDateLike {
  start_at: string
  end_at: string
  latitude: number
  longitude: number
  location_name: string | null
}

export type RepeatMode = 'count' | 'until'

export interface UseCleanupDateForm {
  startAt: string
  endAt: string
  locationName: string
  lat: string
  lon: string
  repeatEnabled: boolean
  repeatFrequency: Frequency
  repeatMode: RepeatMode
  repeatCount: number
  repeatUntil: string

  setStartAt: (v: string) => void
  setLocationName: (v: string) => void
  setLat: (v: string) => void
  setLon: (v: string) => void
  setRepeatEnabled: (v: boolean) => void
  setRepeatFrequency: (v: Frequency) => void
  setRepeatMode: (v: RepeatMode) => void
  setRepeatCount: (v: number) => void
  setRepeatUntil: (v: string) => void

  handleStartFocus: () => void
  handleEndFocus: () => void
  handleEndChange: (value: string) => void

  populateFromDate: (date: CleanupDateLike) => void
  reset: () => void

  repeatPreview: Array<{ startAt: string; endAt: string }>
  nowLocal: string
  durationHoursValue: number | null
}

export function useCleanupDateForm(): UseCleanupDateForm {
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [locationName, setLocationName] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')

  const [repeatEnabled, setRepeatEnabled] = useState(false)
  const [repeatFrequency, setRepeatFrequencyState] = useState<Frequency>('weekly')
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('count')
  const [repeatCount, setRepeatCountState] = useState(4)
  const [repeatUntil, setRepeatUntil] = useState('')

  const setRepeatFrequency = (v: Frequency) => setRepeatFrequencyState(v)
  const setRepeatCount = (v: number) => setRepeatCountState(Math.min(MAX_OCCURRENCES, Math.max(2, v)))

  const handleStartFocus = () => {
    if (!startAt) setStartAt(defaultStartFor(endAt || undefined))
  }

  const handleEndFocus = () => {
    if (!endAt) setEndAt(startAt ? defaultEndFrom(startAt) : '')
  }

  const handleEndChange = (value: string) => {
    if (startAt && new Date(value) < new Date(startAt)) return
    setEndAt(value)
  }

  const populateFromDate = (date: CleanupDateLike) => {
    setStartAt(isoToDatetimeLocal(date.start_at))
    setEndAt(isoToDatetimeLocal(date.end_at))
    setLat(String(date.latitude))
    setLon(String(date.longitude))
    setLocationName(date.location_name || '')
  }

  const reset = () => {
    setStartAt('')
    setEndAt('')
    setLocationName('')
    setLat('')
    setLon('')
    setRepeatEnabled(false)
    setRepeatFrequencyState('weekly')
    setRepeatMode('count')
    setRepeatCountState(4)
    setRepeatUntil('')
  }

  const repeatPreview = repeatEnabled && startAt && endAt
    ? repeatMode === 'until'
      ? generateRecurringDatesUntil(startAt, endAt, repeatFrequency, repeatUntil)
      : generateRecurringDates(startAt, endAt, repeatFrequency, repeatCount)
    : []

  const nowLocal = isoToDatetimeLocal(new Date().toISOString())
  const durationHoursValue = durationHours(startAt, endAt)

  return {
    startAt,
    endAt,
    locationName,
    lat,
    lon,
    repeatEnabled,
    repeatFrequency,
    repeatMode,
    repeatCount,
    repeatUntil,

    setStartAt,
    setLocationName,
    setLat,
    setLon,
    setRepeatEnabled,
    setRepeatFrequency,
    setRepeatMode,
    setRepeatCount,
    setRepeatUntil,

    handleStartFocus,
    handleEndFocus,
    handleEndChange,

    populateFromDate,
    reset,

    repeatPreview,
    nowLocal,
    durationHoursValue,
  }
}
