export interface GradientStop {
  position: number
  color: string
}
export const MAX_GRADIENT_STOPS = 16
export const GRADIENT_QUANTUM = 1 / 4096
export const rgbFromHex = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
export function parseGradientStops(input: unknown): GradientStop[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_GRADIENT_STOPS)
    throw new Error('Карта градиента: от 2 до 16 цветовых точек')
  const stops = input
    .map((v) => {
      if (
        !v ||
        typeof v !== 'object' ||
        typeof v.position !== 'number' ||
        !Number.isFinite(v.position) ||
        v.position < 0 ||
        v.position > 1 ||
        typeof v.color !== 'string' ||
        !/^#[a-f0-9]{6}$/i.test(v.color)
      )
        throw new Error('Некорректная цветовая точка градиента')
      return { position: Math.round(v.position * 4096) / 4096, color: v.color.toLowerCase() }
    })
    .sort((a, b) => a.position - b.position)
  if (stops.some((s, i) => i && s.position === stops[i - 1].position))
    throw new Error('Цветовые точки должны иметь разные позиции (шаг 1/4096)')
  return stops
}
const compiled = new WeakMap<GradientStop[], { positions: number[]; colors: number[][] }>()
export function gradientColor(stops: GradientStop[], value: number, out: number[]) {
  let data = compiled.get(stops)
  if (!data) {
    data = {
      positions: stops.map((s) => s.position),
      colors: stops.map((s) => rgbFromHex(s.color)),
    }
    compiled.set(stops, data)
  }
  const t = Math.max(0, Math.min(1, value)),
    positions = data.positions,
    colors = data.colors
  let lo = 0,
    hi = positions.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (positions[mid] > t) hi = mid
    else lo = mid
  }
  const f = Math.max(0, Math.min(1, (t - positions[lo]) / (positions[hi] - positions[lo])))
  for (let c = 0; c < 3; c++) out[c] = colors[lo][c] + (colors[hi][c] - colors[lo][c]) * f
}
export const gradientPresets: { name: string; stops: GradientStop[] }[] = [
  {
    name: 'Чёрный / белый',
    stops: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
  },
  {
    name: 'Сумерки',
    stops: [
      { position: 0, color: '#152546' },
      { position: 0.5, color: '#927397' },
      { position: 1, color: '#ffe4bb' },
    ],
  },
  {
    name: 'Медь',
    stops: [
      { position: 0, color: '#261b2b' },
      { position: 0.5, color: '#b46b52' },
      { position: 1, color: '#fff1c4' },
    ],
  },
  {
    name: 'Холодный свет',
    stops: [
      { position: 0, color: '#091e37' },
      { position: 0.5, color: '#4d9ca6' },
      { position: 1, color: '#dff8ed' },
    ],
  },
]
