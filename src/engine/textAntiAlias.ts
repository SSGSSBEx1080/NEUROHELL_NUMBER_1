import type { TextAntiAliasMode } from '../types'

export const TEXT_ANTI_ALIAS_MODES = ['none', 'sharp', 'crisp', 'strong', 'smooth'] as const

const MODES = new Set<string>(TEXT_ANTI_ALIAS_MODES)
const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const smoothstep = (value: number) => {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function shapedAlpha(mode: Exclude<TextAntiAliasMode, 'smooth'>, byte: number): number {
  const alpha = clamp01(byte / 255)
  if (mode === 'none') return alpha >= 0.5 ? 255 : 0
  if (mode === 'sharp') return Math.round(smoothstep((alpha - 0.32) / 0.36) * 255)
  if (mode === 'crisp') return Math.round(smoothstep((alpha - 0.18) / 0.64) * 255)
  // Strong is coverage/stem darkening rather than a morphological dilation:
  // its midpoint moves from 50% to 35% input alpha, so existing glyph fringes
  // become visibly heavier without inventing pixels outside the raster edge.
  return Math.round(smoothstep((alpha - 0.04) / 0.62) * 255)
}

const LUTS: Record<TextAntiAliasMode, Uint8ClampedArray> = Object.fromEntries(
  TEXT_ANTI_ALIAS_MODES.map((mode) => [
    mode,
    Uint8ClampedArray.from({ length: 256 }, (_, byte) =>
      mode === 'smooth' ? byte : shapedAlpha(mode, byte),
    ),
  ]),
) as Record<TextAntiAliasMode, Uint8ClampedArray>

/** Accepts only the modes this editor can actually render as grayscale type. */
export function parseTextAntiAlias(value: unknown): TextAntiAliasMode | undefined {
  return typeof value === 'string' && MODES.has(value) ? (value as TextAntiAliasMode) : undefined
}

/** Legacy and newly created layers have no field and keep the old Canvas Smooth path. */
export function textAntiAliasMode(value: unknown): TextAntiAliasMode {
  return parseTextAntiAlias(value) || 'smooth'
}

export interface PsdTextAntiAliasImport {
  mode?: TextAntiAliasMode
  warning?: string
}

/**
 * PSD also has platform and platformLCD values. Canvas is already the host
 * rasterizer for the former; the latter needs display-subpixel data and must
 * not be counterfeited with coloured fringes. Both therefore degrade openly
 * to Smooth only if the imported type is later rebuilt—an untouched PSD is
 * still returned byte-for-byte by the source-preservation path.
 */
export function textAntiAliasFromPsd(value: unknown): PsdTextAntiAliasImport {
  const mode = parseTextAntiAlias(value)
  if (mode) return { mode }
  if (value === 'platform')
    return {
      mode: 'smooth',
      warning:
        'PSD задаёт платформенное сглаживание текста (platform). Рабочий рендер использует обычное сглаживание Canvas («Гладкое»); хинтинг другой операционной системы не воспроизводится.',
    }
  if (value === 'platformLCD')
    return {
      mode: 'smooth',
      warning:
        'PSD задаёт LCD-субпиксельное сглаживание текста. ФШ777 использует серое «Гладкое» сглаживание Canvas и не создаёт поддельные цветные субпиксели; неизменённый PSD сохраняется побайтно.',
    }
  if (typeof value === 'string' && value)
    return {
      warning: `Неизвестный режим сглаживания текста PSD (${value.slice(0, 40)}) не импортирован; используется «Гладкое».`,
    }
  return {}
}

export function textAntiAliasAlphaLut(value: unknown): Uint8ClampedArray {
  return LUTS[textAntiAliasMode(value)]
}

/**
 * Shape only the alpha coverage produced by Canvas. RGB is untouched, so a
 * genuinely multicolour glyph keeps its colours; monochrome PSD previews are
 * separately canonicalised by textPreview. Smooth is deliberately identity.
 */
export function applyTextAntiAliasToPixels(data: Uint8ClampedArray, value: unknown): void {
  const mode = textAntiAliasMode(value)
  if (mode === 'smooth') return
  const lut = LUTS[mode]
  for (let i = 3; i < data.length; i += 4) data[i] = lut[data[i]]
}
