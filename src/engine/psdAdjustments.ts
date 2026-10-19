import { MAX_CUBE_BYTES, parseCubeFile, serializeCube } from './colorLut'
import type { AdjustmentLayer } from 'ag-psd'
import {
  defaultCorrection,
  parseCorrection,
  toneChannels,
  type Correction,
  type LevelRange,
  type ToneChannel,
  type MixerRow,
} from './adjustmentTypes'
const rgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
})
const hex = (c: import('ag-psd').Color | undefined) =>
  c && 'r' in c && [c.r, c.g, c.b].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)
    ? '#' + [c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
    : undefined
const zero = { a: 0, b: 0, c: 0, d: 0, hue: 0, saturation: 0, lightness: 0 }
// phfl stores an integer percent. Avoid truncating e.g. 0.29*100 to 28 in ag-psd.
const nativeDensity = (percent: number) => {
  const n = Math.round(percent),
    ratio = n / 100
  return ratio * 100 < n ? ratio + Number.EPSILON : ratio
}
export function exportAdjustment(c: Correction): AdjustmentLayer {
  if (c.type === 'photo filter')
    return {
      type: c.type,
      color: rgb(c.color),
      density: nativeDensity(c.density),
      preserveLuminosity: c.preserveLuminosity,
    }
  if (c.type === 'gradient map')
    return {
      type: c.type,
      gradientType: 'solid',
      name: 'ФШ777',
      // Legacy grdm is classic by definition. ag-psd 31's v3 method writer
      // passes a descriptor enum where the format requires a 4-byte signature.
      // Do not emit a broken v3 record or claim its newer interpolation methods.
      colorModel: 'rgb',
      smoothness: 1,
      dither: false,
      reverse: c.reverse,
      colorStops: c.stops.map((s) => ({
        location: s.position,
        color: rgb(s.color),
        midpoint: 0.5,
      })),
      opacityStops: [
        { location: 0, opacity: 1, midpoint: 0.5 },
        { location: 1, opacity: 1, midpoint: 0.5 },
      ],
    }
  if (c.type === 'color lookup')
    return {
      type: c.type,
      lookupType: '3dlut',
      name: c.lut.title,
      lutFormat: 'cube',
      dataOrder: 'rgb',
      tableOrder: 'rgb',
      dither: false,
      lut3DFileName: c.lut.title + '.cube',
      lut3DFileData: new TextEncoder().encode(serializeCube(c.lut)),
    }

  if (c.type === 'levels')
    return {
      type: c.type,
      ...Object.fromEntries(
        toneChannels.map((k) => {
          const v = c.channels[k]
          return [
            k,
            {
              shadowInput: v.black,
              highlightInput: v.white,
              midtoneInput: v.gamma,
              shadowOutput: v.outBlack,
              highlightOutput: v.outWhite,
            },
          ]
        }),
      ),
    }
  if (c.type === 'curves') return { type: c.type, ...c.channels }
  if (c.type === 'brightness/contrast')
    return { ...c, meanValue: 127, useLegacy: true, labColorOnly: false, auto: false }
  if (c.type === 'hue/saturation')
    return {
      type: c.type,
      master: { ...zero, hue: c.hue, saturation: c.saturation, lightness: c.lightness },
    }
  if (c.type === 'color balance')
    return {
      type: c.type,
      preserveLuminosity: c.preserveLuminosity,
      ...Object.fromEntries(
        (['shadows', 'midtones', 'highlights'] as const).map((k) => [
          k,
          { cyanRed: c[k].red, magentaGreen: c[k].green, yellowBlue: c[k].blue },
        ]),
      ),
    }
  if (c.type === 'black & white') return { ...c, useTint: false }
  return { ...c }
}
/** Only representable variants become editable. All others keep the original layer and warn. */
export function importAdjustment(a: AdjustmentLayer | undefined): Correction | undefined {
  if (!a) return
  try {
    if (a.type === 'photo filter') {
      const color = hex(a.color)
      if (!color || !Number.isFinite(a.density) || a.density! < 0 || a.density! > 1) return
      return parseCorrection({
        type: a.type,
        color,
        density: a.density! * 100,
        preserveLuminosity: a.preserveLuminosity,
      })
    }
    if (a.type === 'gradient map') {
      if (
        a.gradientType !== 'solid' ||
        a.dither ||
        a.method !== undefined ||
        (a.colorModel && a.colorModel !== 'rgb') ||
        (a.smoothness !== undefined && a.smoothness !== 1) ||
        a.addTransparency ||
        !a.colorStops?.length ||
        a.colorStops.some((s) => !hex(s.color) || Math.abs(s.midpoint - 0.5) > 1e-6) ||
        a.opacityStops?.some((s) => s.opacity !== 1)
      )
        return
      return parseCorrection({
        type: a.type,
        reverse: a.reverse,
        stops: a.colorStops.map((s) => ({ position: s.location, color: hex(s.color) })),
      })
    }
    if (a.type === 'color lookup') {
      if (
        a.lookupType !== '3dlut' ||
        a.lutFormat !== 'cube' ||
        a.dither ||
        a.profile?.length ||
        (a.dataOrder && a.dataOrder !== 'rgb') ||
        (a.tableOrder && a.tableOrder !== 'rgb') ||
        !a.lut3DFileData?.length ||
        a.lut3DFileData.length > MAX_CUBE_BYTES
      )
        return
      return parseCorrection({
        type: a.type,
        lut: parseCubeFile(
          new TextDecoder('utf-8', { fatal: true }).decode(a.lut3DFileData),
          a.name || '3D LUT',
        ),
      })
    }
    if (a.type === 'levels') {
      const channels = Object.fromEntries(
        toneChannels.map((k) => {
          const c = a[k]
          return [
            k,
            c
              ? {
                  black: c.shadowInput,
                  white: c.highlightInput,
                  gamma: c.midtoneInput,
                  outBlack: c.shadowOutput,
                  outWhite: c.highlightOutput,
                }
              : undefined,
          ]
        }),
      ) as Record<ToneChannel, LevelRange>
      return parseCorrection({ type: a.type, channels })
    }
    if (a.type === 'curves')
      return parseCorrection({
        type: a.type,
        channels: { rgb: a.rgb, red: a.red, green: a.green, blue: a.blue },
      })
    if (a.type === 'brightness/contrast') {
      if (!a.useLegacy || a.labColorOnly || a.auto) return
      return parseCorrection(a)
    }
    if (a.type === 'hue/saturation') {
      if (
        (['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).some(
          (k) => a[k] && (a[k]!.hue || a[k]!.saturation || a[k]!.lightness),
        )
      )
        return
      return parseCorrection({
        type: a.type,
        hue: a.master?.hue,
        saturation: a.master?.saturation,
        lightness: a.master?.lightness,
      })
    }
    if (a.type === 'color balance')
      return parseCorrection({
        type: a.type,
        preserveLuminosity: a.preserveLuminosity,
        ...Object.fromEntries(
          (['shadows', 'midtones', 'highlights'] as const).map((k) => [
            k,
            { red: a[k]?.cyanRed, green: a[k]?.magentaGreen, blue: a[k]?.yellowBlue },
          ]),
        ),
      })
    if (a.type === 'black & white' && a.useTint) return
    if (
      [
        'exposure',
        'vibrance',
        'black & white',
        'channel mixer',
        'invert',
        'posterize',
        'threshold',
      ].includes(a.type)
    )
      return parseCorrection(a)
  } catch {
    return undefined
  }
}
// Curves/levels/mixer may not carry unused channels in a native file. Parsing supplies identity defaults.
export const defaultMixerRow = (channel: 'red' | 'green' | 'blue' | 'gray'): MixerRow =>
  (defaultCorrection('channel mixer') as Extract<Correction, { type: 'channel mixer' }>)[channel]

/** The decoder exposes integer phfl percentages as fractions. ag-psd's writer
 * truncates their product, so even preserving a raw 29% layer could write 28%.
 * Correct the representation before EVERY write, including preserved raw layers.
 * No correction is applied on read: an externally authored 28% really stays 28%.
 */
export function prepareAdjustmentRecords(layers: import('ag-psd').Layer[]) {
  for (const layer of layers) {
    const a = layer.adjustment
    if (
      a?.type === 'photo filter' &&
      a.density !== undefined &&
      Number.isFinite(a.density) &&
      a.density >= 0 &&
      a.density <= 1
    )
      a.density = nativeDensity(Math.round(a.density * 100))
    if (layer.children) prepareAdjustmentRecords(layer.children)
  }
}
