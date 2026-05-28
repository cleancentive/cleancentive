import type { DatePreset, PickedUpFilter, CleanupFilter, SubjectFilter } from '../stores/insightsFilterStore'
import type { HeatMetric } from '../stores/mapStore'

export interface MapViewState {
  lon: number
  lat: number
  zoom: number
}

export interface MapUrlState {
  datePreset?: DatePreset
  pickedUpFilter?: PickedUpFilter
  subjectFilter?: SubjectFilter
  myFilter?: boolean
  cleanupFilter?: CleanupFilter
  heatMetric?: HeatMetric
  view?: MapViewState
}

const DATE_PRESETS: readonly DatePreset[] = ['7d', '30d', '1y', 'all']
const PICKED_UP_VALUES: readonly PickedUpFilter[] = ['picked', 'spotted', 'all']
const SUBJECT_VALUES: readonly SubjectFilter[] = ['litter', 'plants', 'all']
const HEAT_METRICS: readonly HeatMetric[] = ['items', 'mass']

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s)
}

export function serializeMapState(state: MapUrlState): URLSearchParams {
  const params = new URLSearchParams()

  if (state.datePreset && state.datePreset !== 'all') {
    params.set('since', state.datePreset)
  }
  if (state.pickedUpFilter && state.pickedUpFilter !== 'all') {
    params.set('picked', state.pickedUpFilter)
  }
  if (state.subjectFilter && state.subjectFilter !== 'all') {
    params.set('subject', state.subjectFilter)
  }
  if (state.myFilter) {
    params.set('mine', '1')
  }
  if (state.cleanupFilter) {
    params.set('cleanup', state.cleanupFilter.cleanupId)
    if (state.cleanupFilter.kind === 'date') {
      params.set('cleanupDate', state.cleanupFilter.cleanupDateId)
    }
  }
  if (state.heatMetric && state.heatMetric !== 'items') {
    params.set('metric', state.heatMetric)
  }
  if (state.view) {
    const { lon, lat, zoom } = state.view
    params.set('view', `${lon.toFixed(3)},${lat.toFixed(3)},${zoom.toFixed(2)}`)
  }

  return params
}

export function parseMapState(searchParams: URLSearchParams): MapUrlState {
  const result: MapUrlState = {}

  const since = searchParams.get('since')
  if (since && (DATE_PRESETS as readonly string[]).includes(since)) {
    result.datePreset = since as DatePreset
  }

  const picked = searchParams.get('picked')
  if (picked && (PICKED_UP_VALUES as readonly string[]).includes(picked)) {
    result.pickedUpFilter = picked as PickedUpFilter
  }

  const subject = searchParams.get('subject')
  if (subject && (SUBJECT_VALUES as readonly string[]).includes(subject)) {
    result.subjectFilter = subject as SubjectFilter
  }

  if (searchParams.get('mine') === '1') {
    result.myFilter = true
  }

  const cleanupId = searchParams.get('cleanup')
  if (cleanupId && isValidUuid(cleanupId)) {
    const cleanupDateId = searchParams.get('cleanupDate')
    if (cleanupDateId && isValidUuid(cleanupDateId)) {
      result.cleanupFilter = {
        kind: 'date',
        cleanupId,
        cleanupDateId,
        cleanupName: '',
      }
    } else {
      result.cleanupFilter = {
        kind: 'cleanup',
        cleanupId,
        cleanupName: '',
      }
    }
  }

  const metric = searchParams.get('metric')
  if (metric && (HEAT_METRICS as readonly string[]).includes(metric)) {
    result.heatMetric = metric as HeatMetric
  }

  const view = searchParams.get('view')
  if (view) {
    const parts = view.split(',')
    if (parts.length === 3) {
      const lon = Number(parts[0])
      const lat = Number(parts[1])
      const zoom = Number(parts[2])
      if (
        Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(zoom) && zoom >= 0 && zoom <= 24
      ) {
        result.view = { lon, lat, zoom }
      }
    }
  }

  return result
}
