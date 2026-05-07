import { create } from 'zustand'
import axios from 'axios'

export interface ArtifactVersion {
  commit: string
  commitShort: string
  buildTime: number
}

export interface VersionInfo {
  backend: ArtifactVersion
  worker: ArtifactVersion | null
}

interface VersionState {
  versionInfo: VersionInfo | null
  fetchVersionInfo: () => Promise<void>
}

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1'

export const useVersionStore = create<VersionState>((set) => ({
  versionInfo: null,

  fetchVersionInfo: async () => {
    try {
      const response = await axios.get(`${API_BASE}/version`)
      set({ versionInfo: response.data })
    } catch {
      // version info is non-critical, silently ignore
    }
  },
}))
