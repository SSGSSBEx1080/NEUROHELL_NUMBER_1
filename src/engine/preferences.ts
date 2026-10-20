export interface Preferences {
  theme: 'violet' | 'graphite' | 'warm' | 'aurora'
  history: number
  autosave: number
  checker: number
  smooth: boolean
  reduceMotion: boolean
  showPerformance: boolean
  colorMismatchPolicy: 'ask' | 'convert' | 'discard' | 'assign-working'
  colorMissingPolicy: 'ask' | 'leave' | 'assign-working'
  colorGrayProfile: 'sgray' | 'gray-gamma-1.8' | 'gray-gamma-2.2'
  colorIntent: 'relative' | 'absolute'
  colorBlackPoint: boolean
  colorDither: boolean
}
export const defaultPreferences: Preferences = {
  theme: 'violet',
  history: 50,
  autosave: 1200,
  checker: 16,
  smooth: true,
  reduceMotion: false,
  showPerformance: false,
  colorMismatchPolicy: 'ask',
  colorMissingPolicy: 'ask',
  colorGrayProfile: 'sgray',
  colorIntent: 'relative',
  colorBlackPoint: true,
  colorDither: true,
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
      colorMismatchPolicy: ['ask', 'convert', 'discard', 'assign-working'].includes(
        p.colorMismatchPolicy,
      )
        ? p.colorMismatchPolicy
        : 'ask',
      colorMissingPolicy: ['ask', 'leave', 'assign-working'].includes(p.colorMissingPolicy)
        ? p.colorMissingPolicy
        : 'ask',
      colorGrayProfile: ['sgray', 'gray-gamma-1.8', 'gray-gamma-2.2'].includes(p.colorGrayProfile)
        ? p.colorGrayProfile
        : 'sgray',
      colorIntent: p.colorIntent === 'absolute' ? 'absolute' : 'relative',
      colorBlackPoint: p.colorBlackPoint !== false,
      colorDither: p.colorDither !== false,
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
