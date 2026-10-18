export interface Preferences {
  theme: 'violet' | 'graphite' | 'warm' | 'aurora'
  history: number
  autosave: number
  checker: number
  smooth: boolean
  reduceMotion: boolean
  showPerformance: boolean
}
export const defaultPreferences: Preferences = {
  theme: 'violet',
  history: 50,
  autosave: 1200,
  checker: 16,
  smooth: true,
  reduceMotion: false,
  showPerformance: false,
}
export function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('fsh777-preferences') || '{}')
    return {
      theme: ['violet', 'graphite', 'warm', 'aurora'].includes(p.theme) ? p.theme : 'violet',
      history: Math.min(100, Math.max(10, Number(p.history) || 50)),
      autosave: Math.min(10000, Math.max(500, Number(p.autosave) || 1200)),
      checker: [8, 16, 24, 32].includes(p.checker) ? p.checker : 16,
      smooth: p.smooth !== false,
      reduceMotion: !!p.reduceMotion,
      showPerformance: !!p.showPerformance,
    }
  } catch {
    return { ...defaultPreferences }
  }
}
export function savePreferences(p: Preferences) {
  try {
    localStorage.setItem('fsh777-preferences', JSON.stringify(p))
    localStorage.setItem('fsh777-history-limit', String(p.history))
  } catch {
    /* Editing remains possible with blocked storage. */
  }
}
