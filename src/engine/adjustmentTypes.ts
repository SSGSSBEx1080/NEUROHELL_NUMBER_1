export type ToneChannel = 'rgb' | 'red' | 'green' | 'blue'
export const toneChannels: ToneChannel[] = ['rgb', 'red', 'green', 'blue']
export interface LevelRange {
  black: number
  white: number
  gamma: number
  outBlack: number
  outWhite: number
}
export interface CurvePoint {
  input: number
  output: number
}
export interface MixerRow {
  red: number
  green: number
  blue: number
  constant: number
}
export interface BalanceRange {
  red: number
  green: number
  blue: number
}
export type Correction =
  | { type: 'brightness/contrast'; brightness: number; contrast: number }
  | { type: 'levels'; channels: Record<ToneChannel, LevelRange> }
  | { type: 'curves'; channels: Record<ToneChannel, CurvePoint[]> }
  | { type: 'exposure'; exposure: number; offset: number; gamma: number }
  | { type: 'hue/saturation'; hue: number; saturation: number; lightness: number }
  | { type: 'vibrance'; vibrance: number; saturation: number }
  | {
      type: 'color balance'
      shadows: BalanceRange
      midtones: BalanceRange
      highlights: BalanceRange
      preserveLuminosity: boolean
    }
  | {
      type: 'black & white'
      reds: number
      yellows: number
      greens: number
      cyans: number
      blues: number
      magentas: number
    }
  | {
      type: 'channel mixer'
      monochrome: boolean
      red: MixerRow
      green: MixerRow
      blue: MixerRow
      gray: MixerRow
    }
  | { type: 'invert' }
  | { type: 'posterize'; levels: number }
  | { type: 'threshold'; level: number }
export type CorrectionKind = Correction['type']
export const correctionNames: Record<CorrectionKind, string> = {
  'brightness/contrast': 'Яркость / контрастность',
  levels: 'Уровни',
  curves: 'Кривые',
  exposure: 'Экспозиция',
  'hue/saturation': 'Цветовой тон / насыщенность',
  vibrance: 'Вибрация',
  'color balance': 'Цветовой баланс',
  'black & white': 'Чёрно-белое',
  'channel mixer': 'Микшер каналов',
  invert: 'Инверсия',
  posterize: 'Постеризация',
  threshold: 'Порог',
}
const range = (): LevelRange => ({ black: 0, white: 255, gamma: 1, outBlack: 0, outWhite: 255 })
const balance = (): BalanceRange => ({ red: 0, green: 0, blue: 0 })
export function defaultCorrection(type: CorrectionKind): Correction {
  switch (type) {
    case 'brightness/contrast':
      return { type, brightness: 0, contrast: 0 }
    case 'levels':
      return { type, channels: { rgb: range(), red: range(), green: range(), blue: range() } }
    case 'curves':
      return {
        type,
        channels: Object.fromEntries(
          toneChannels.map((c) => [
            c,
            [
              { input: 0, output: 0 },
              { input: 255, output: 255 },
            ],
          ]),
        ) as Record<ToneChannel, CurvePoint[]>,
      }
    case 'exposure':
      return { type, exposure: 0, offset: 0, gamma: 1 }
    case 'hue/saturation':
      return { type, hue: 0, saturation: 0, lightness: 0 }
    case 'vibrance':
      return { type, vibrance: 0, saturation: 0 }
    case 'color balance':
      return {
        type,
        shadows: balance(),
        midtones: balance(),
        highlights: balance(),
        preserveLuminosity: true,
      }
    case 'black & white':
      return { type, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }
    case 'channel mixer':
      return {
        type,
        monochrome: false,
        red: { red: 100, green: 0, blue: 0, constant: 0 },
        green: { red: 0, green: 100, blue: 0, constant: 0 },
        blue: { red: 0, green: 0, blue: 100, constant: 0 },
        gray: { red: 30, green: 59, blue: 11, constant: 0 },
      }
    case 'invert':
      return { type }
    case 'posterize':
      return { type, levels: 4 }
    case 'threshold':
      return { type, level: 128 }
  }
}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Некорректная коррекция')
  return v as Record<string, unknown>
}
const number = (v: unknown, min: number, max: number, fallback: number) => {
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v))
    throw new Error('Параметры коррекции должны быть конечными числами')
  return Math.min(max, Math.max(min, v))
}
/** Data-only, bounded representation. Unknown types must fail, never silently become a bitmap. */
export function parseCorrection(input: unknown): Correction {
  const v = record(input)
  if (typeof v.type !== 'string' || !Object.hasOwn(correctionNames, v.type))
    throw new Error('Неизвестный корректирующий слой')
  const defaults = defaultCorrection(v.type as CorrectionKind)
  if (defaults.type === 'levels') {
    const channels = record(v.channels || {})
    return {
      type: defaults.type,
      channels: Object.fromEntries(
        toneChannels.map((c) => {
          const x = record(channels[c] || {}),
            black = Math.round(number(x.black, 0, 254, 0))
          return [
            c,
            {
              black,
              white: Math.round(number(x.white, black + 1, 255, 255)),
              gamma: number(x.gamma, 0.1, 9.99, 1),
              outBlack: Math.round(number(x.outBlack, 0, 255, 0)),
              outWhite: Math.round(number(x.outWhite, 0, 255, 255)),
            },
          ]
        }),
      ) as Record<ToneChannel, LevelRange>,
    }
  }
  if (defaults.type === 'curves') {
    const channels = record(v.channels || {})
    return {
      type: defaults.type,
      channels: Object.fromEntries(
        toneChannels.map((c) => {
          const raw = channels[c] ?? defaults.channels[c]
          if (!Array.isArray(raw) || raw.length < 2 || raw.length > 16)
            throw new Error('Кривая: от 2 до 16 точек')
          const points = raw
            .map((p) => {
              const o = record(p)
              return {
                input: Math.round(number(o.input, 0, 255, 0)),
                output: Math.round(number(o.output, 0, 255, 0)),
              }
            })
            .sort((a, b) => a.input - b.input)
          if (points.some((p, i) => i && p.input === points[i - 1].input))
            throw new Error('Точки кривой должны иметь разные входные значения')
          return [c, points]
        }),
      ) as Record<ToneChannel, CurvePoint[]>,
    }
  }
  if (defaults.type === 'color balance') {
    const ranges = Object.fromEntries(
      (['shadows', 'midtones', 'highlights'] as const).map((c) => {
        const x = record(v[c] || {})
        return [
          c,
          {
            red: number(x.red, -100, 100, 0),
            green: number(x.green, -100, 100, 0),
            blue: number(x.blue, -100, 100, 0),
          },
        ]
      }),
    ) as Pick<typeof defaults, 'shadows' | 'midtones' | 'highlights'>
    return { type: defaults.type, ...ranges, preserveLuminosity: v.preserveLuminosity !== false }
  }
  if (defaults.type === 'channel mixer') {
    const rows = Object.fromEntries(
      (['red', 'green', 'blue', 'gray'] as const).map((c) => {
        const x = record(v[c] || {})
        return [
          c,
          {
            red: number(x.red, -200, 200, defaults[c].red),
            green: number(x.green, -200, 200, defaults[c].green),
            blue: number(x.blue, -200, 200, defaults[c].blue),
            constant: number(x.constant, -200, 200, defaults[c].constant),
          },
        ]
      }),
    ) as Pick<typeof defaults, 'red' | 'green' | 'blue' | 'gray'>
    return { type: defaults.type, ...rows, monochrome: v.monochrome === true }
  }
  const out: Record<string, unknown> = { type: defaults.type }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (key === 'type' || typeof fallback !== 'number') continue
    const limits: [number, number] =
      key === 'gamma'
        ? [0.1, 9.99]
        : key === 'exposure'
          ? [-10, 10]
          : key === 'offset'
            ? [-0.5, 0.5]
            : key === 'hue'
              ? [-180, 180]
              : key === 'levels'
                ? [2, 256]
                : key === 'level'
                  ? [0, 255]
                  : defaults.type === 'black & white'
                    ? [-200, 300]
                    : [-100, 100]
    const value = number(v[key], ...limits, fallback)
    out[key] = ['level', 'levels'].includes(key) ? Math.round(value) : value
  }
  return out as Correction
}
