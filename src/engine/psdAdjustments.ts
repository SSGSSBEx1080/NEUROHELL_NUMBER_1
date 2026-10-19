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
const zero = { a: 0, b: 0, c: 0, d: 0, hue: 0, saturation: 0, lightness: 0 }
export function exportAdjustment(c: Correction): AdjustmentLayer {
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
