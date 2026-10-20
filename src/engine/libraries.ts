import { parseGradientDefinition, type GradientDefinition } from './gradientRamp'
import { normalizeStyles } from './styles'
import type { LayerStyles } from '../types'

export const GRADIENT_LIBRARY_KEY = 'fsh777-gradient-library'
export const STYLE_LIBRARY_KEY = 'fsh777-style-library'
export const STYLE_CLIPBOARD_KEY = 'fsh777-style-clipboard'
export const MAX_LIBRARY_ITEMS = 64

export interface StylePreset {
  name: string
  styles: LayerStyles
}

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Library storage is best-effort; the document itself is never stored here. */
  }
}
const nameOf = (v: unknown, fallback: string) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : fallback

export function parseGradientLibrary(input: unknown): GradientDefinition[] {
  const items =
    input &&
    typeof input === 'object' &&
    Array.isArray((input as { gradients?: unknown }).gradients)
      ? (input as { gradients: unknown[] }).gradients
      : Array.isArray(input)
        ? input
        : []
  const result: GradientDefinition[] = []
  for (const item of items.slice(0, MAX_LIBRARY_ITEMS)) {
    try {
      result.push(parseGradientDefinition(item))
    } catch {
      /* Skip a broken entry instead of rejecting the whole library. */
    }
  }
  return result
}
export const loadGradientLibrary = (): GradientDefinition[] =>
  parseGradientLibrary(read(GRADIENT_LIBRARY_KEY))
export const saveGradientLibrary = (items: GradientDefinition[]) =>
  write(GRADIENT_LIBRARY_KEY, items.slice(0, MAX_LIBRARY_ITEMS))
export function parseGradientLibraryFile(text: string): GradientDefinition[] {
  if (text.length > 512 * 1024) throw new Error('Файл градиентов больше 512 КиБ')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Файл градиентов не является корректным JSON')
  }
  const kind = (parsed as { kind?: unknown })?.kind
  if (kind !== undefined && kind !== 'fsh777-gradients')
    throw new Error('Это не файл градиентов ФШ777')
  const items = parseGradientLibrary(parsed)
  if (!items.length) throw new Error('В файле нет ни одного исправного градиента')
  return items
}
export const serializeGradientLibrary = (items: GradientDefinition[]) =>
  JSON.stringify({ kind: 'fsh777-gradients', version: 1, gradients: items }, null, 2)

export function parseStyleLibrary(input: unknown): StylePreset[] {
  const items =
    input && typeof input === 'object' && Array.isArray((input as { styles?: unknown }).styles)
      ? (input as { styles: unknown[] }).styles
      : Array.isArray(input)
        ? input
        : []
  const result: StylePreset[] = []
  for (const item of items.slice(0, MAX_LIBRARY_ITEMS)) {
    if (!item || typeof item !== 'object') continue
    const styles = normalizeStyles((item as { styles?: unknown }).styles ?? item)
    if (styles) result.push({ name: nameOf((item as { name?: unknown }).name, 'Стиль'), styles })
  }
  return result
}
export const loadStyleLibrary = (): StylePreset[] => parseStyleLibrary(read(STYLE_LIBRARY_KEY))
export const saveStyleLibrary = (items: StylePreset[]) =>
  write(STYLE_LIBRARY_KEY, items.slice(0, MAX_LIBRARY_ITEMS))
export function parseStyleLibraryFile(text: string): StylePreset[] {
  if (text.length > 512 * 1024) throw new Error('Файл стилей больше 512 КиБ')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Файл стилей не является корректным JSON')
  }
  const kind = (parsed as { kind?: unknown })?.kind
  if (kind !== undefined && kind !== 'fsh777-styles') throw new Error('Это не файл стилей ФШ777')
  const items = parseStyleLibrary(parsed)
  if (!items.length) throw new Error('В файле нет ни одного исправного стиля')
  return items
}
export const serializeStyleLibrary = (items: StylePreset[]) =>
  JSON.stringify({ kind: 'fsh777-styles', version: 1, styles: items }, null, 2)

let clipboard: LayerStyles | undefined
export function copyStyleToClipboard(styles: LayerStyles) {
  clipboard = structuredClone(styles)
  write(STYLE_CLIPBOARD_KEY, clipboard)
}
export function readStyleClipboard(): LayerStyles | undefined {
  if (clipboard) return structuredClone(clipboard)
  const stored = normalizeStyles(read(STYLE_CLIPBOARD_KEY))
  if (stored) clipboard = stored
  return stored ? structuredClone(stored) : undefined
}

/** Built-in presets; every parameter below is rendered and exported to PSD. */
export const builtinStylePresets: StylePreset[] = (
  [
    {
      name: 'Тройная обводка ULTRA',
      styles: {
        strokes: [
          { enabled: true, size: 2, color: '#ffffff', position: 'outside', opacity: 1 },
          { enabled: true, size: 7, color: '#ff5c39', position: 'outside', opacity: 1 },
          { enabled: true, size: 13, color: '#152546', position: 'outside', opacity: 1 },
        ],
        shadows: [{ enabled: true, color: '#000000', blur: 10, x: 0, y: 8, opacity: 0.45 }],
      },
    },
    {
      name: 'Неон в темноте',
      styles: {
        fillOpacity: 0.15,
        strokes: [{ enabled: true, size: 2, color: '#7df9ff', position: 'center', opacity: 1 }],
        glow: { enabled: true, color: '#00c2ff', blur: 26, opacity: 0.9 },
        innerGlow: { enabled: true, color: '#b6a3ff', blur: 14, opacity: 0.7 },
      },
    },
    {
      name: 'Мягкая карточка',
      styles: {
        shadows: [
          { enabled: true, color: '#1b2432', blur: 6, x: 0, y: 3, opacity: 0.35 },
          { enabled: true, color: '#1b2432', blur: 28, x: 0, y: 14, opacity: 0.22 },
        ],
        innerShadows: [{ enabled: true, color: '#000000', blur: 4, x: 0, y: 2, opacity: 0.18 }],
      },
    },
    {
      name: 'Золотой час',
      styles: {
        gradients: [
          {
            enabled: true,
            angle: 90,
            opacity: 1,
            reverse: false,
            gradient: {
              name: 'Золотой час',
              kind: 'solid',
              stops: [
                { position: 0, color: '#fff3b0', midpoint: 0.35 },
                { position: 0.55, color: '#ffb703' },
                { position: 1, color: '#9d4edd' },
              ],
            },
          },
        ],
        strokes: [{ enabled: true, size: 1, color: '#ffffff', position: 'inside', opacity: 0.7 }],
        innerGlow: { enabled: true, color: '#ffe9a8', blur: 10, opacity: 0.55 },
      },
    },
  ] as { name: string; styles: unknown }[]
).map((p) => ({ name: p.name, styles: normalizeStyles(p.styles)! }))
