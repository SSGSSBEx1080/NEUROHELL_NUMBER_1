import { readAbr, type Brush as AbrBrush, type SampleInfo } from 'ag-psd'
import {
  brushPresetId,
  clampBrushNumber as clamp,
  MAX_ABR_BYTES,
  sanitizeBrushPresetSettings,
  type AbrImportedPreset,
  type AbrImportResult,
  type BrushPresetSettings,
} from './brushPresets'

const percent = (value: number | undefined, min = 0, max = 100, fallback = 0) =>
  clamp((value ?? fallback / 100) * 100, min, max, fallback)

const dynamicsSettings = (
  brush: AbrBrush,
  settings: BrushPresetSettings,
  unsupported: string[],
) => {
  const shapeDyn = brush.shapeDynamics
  if (shapeDyn) {
    if (shapeDyn.sizeDynamics.control === 'pen pressure') settings.pressureSize = true
    else if (shapeDyn.sizeDynamics.control !== 'off' && shapeDyn.sizeDynamics.control !== 'fade')
      unsupported.push('управление размером: ' + shapeDyn.sizeDynamics.control)
    if (shapeDyn.sizeDynamics.control === 'fade') unsupported.push('затухание размера по шагам')
    settings.brushSizeJitter = percent(shapeDyn.sizeDynamics.jitter)
    settings.brushMinimumDiameter = Math.max(
      percent(shapeDyn.minimumDiameter),
      percent(shapeDyn.sizeDynamics.minimum),
    )
    if (shapeDyn.angleDynamics.control === 'direction') settings.brushAngleControl = 'direction'
    else if (shapeDyn.angleDynamics.control === 'initial direction')
      settings.brushAngleControl = 'initial'
    else if (shapeDyn.angleDynamics.control !== 'off' && shapeDyn.angleDynamics.control !== 'fade')
      unsupported.push('управление углом: ' + shapeDyn.angleDynamics.control)
    if (shapeDyn.angleDynamics.control === 'fade') unsupported.push('затухание угла по шагам')
    settings.brushAngleJitter = percent(shapeDyn.angleDynamics.jitter)
    settings.brushRoundnessJitter = percent(shapeDyn.roundnessDynamics.jitter)
    settings.brushMinimumRoundness = percent(shapeDyn.minimumRoundness, 1, 100, 25)
    settings.brushFlipXJitter = shapeDyn.flipX
    settings.brushFlipYJitter = shapeDyn.flipY
    if (shapeDyn.tiltScale) unsupported.push('масштаб от наклона пера')
    if (shapeDyn.brushProjection) unsupported.push('проекция кисти')
  }
  if (brush.scatter) {
    settings.brushScatter = percent(brush.scatter.scatterDynamics.jitter, 0, 1000)
    settings.brushScatterBothAxes = brush.scatter.bothAxes
    settings.brushScatterCount = Math.round(clamp(brush.scatter.count || 1, 1, 16, 1))
    settings.brushCountJitter = percent(brush.scatter.countDynamics.jitter)
    if (brush.scatter.scatterDynamics.control !== 'off')
      unsupported.push('управление рассеиванием: ' + brush.scatter.scatterDynamics.control)
    if (brush.scatter.countDynamics.control !== 'off')
      unsupported.push('управление числом отпечатков: ' + brush.scatter.countDynamics.control)
  }
  if (brush.transfer) {
    const { flowDynamics, opacityDynamics, wetnessDynamics, mixDynamics } = brush.transfer
    settings.brushOpacityJitter = percent(Math.max(flowDynamics.jitter, opacityDynamics.jitter))
    settings.brushMinimumOpacity = Math.max(
      percent(flowDynamics.minimum),
      percent(opacityDynamics.minimum),
    )
    if (flowDynamics.control === 'pen pressure' || opacityDynamics.control === 'pen pressure')
      settings.pressureOpacity = true
    if (wetnessDynamics.jitter || wetnessDynamics.control !== 'off') unsupported.push('влажность')
    if (mixDynamics.jitter || mixDynamics.control !== 'off') unsupported.push('смешивание краски')
  }
  const to = brush.toolOptions
  if (to) {
    if (to.type !== 'brush') unsupported.push('тип инструмента: ' + to.type)
    if (to.mode !== 'normal') unsupported.push('режим наложения кисти: ' + to.mode)
    if (to.wetness !== undefined || to.dryness !== undefined || to.mix !== undefined)
      unsupported.push('параметры mixer brush')
    settings.brushOpacity = Math.max(
      1,
      Math.round((clamp(to.opacity, 0, 100, 100) * clamp(to.flow, 0, 100, 100)) / 100),
    )
    if (to.smoothing) settings.brushSmoothing = clamp(to.smoothingValue, 0, 100, 0)
    settings.pressureSize = to.usePressureOverridesSize || settings.pressureSize
    settings.pressureOpacity = to.usePressureOverridesOpacity || settings.pressureOpacity
  }
}

/**
 * Parses modern ABR packages through ag-psd and maps the supported subset.
 * Legacy ABR v1/v2 and 16-bit RLE samples are rejected by ag-psd; that error
 * is surfaced instead of importing silently degraded brushes.
 */
export function parseAbrBrushes(buffer: ArrayBuffer | Uint8Array): AbrImportResult {
  if (buffer.byteLength > MAX_ABR_BYTES) throw new Error('ABR-пакет больше 96 МиБ')
  let abr
  try {
    abr = readAbr(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
  } catch (error) {
    throw new Error(
      `Не удалось прочитать ABR: ${error instanceof Error ? error.message : 'повреждён файл'}. Поддерживаются современные ABR v6/7/9/10 (minor 1/2) через ag-psd; legacy v1/v2 и 16-bit RLE наконечники не поддерживаются.`,
    )
  }
  if (abr.samples.length > 1024 || abr.brushes.length > 1024)
    throw new Error('Слишком много кистей в ABR-пакете (до 1024)')
  let totalPixels = 0
  for (const sample of abr.samples) {
    const pixels = sample.bounds.w * sample.bounds.h
    if (
      sample.bounds.w < 1 ||
      sample.bounds.h < 1 ||
      sample.bounds.w > 5000 ||
      sample.bounds.h > 5000 ||
      sample.alpha.length !== pixels
    )
      throw new Error('Некорректный размер наконечника в ABR')
    totalPixels += pixels
    if (totalPixels > 67_108_864) throw new Error('Суммарный размер наконечников ABR больше 64 Мп')
  }
  const byId = new Map(abr.samples.map((sample) => [sample.id, sample])),
    referenced = new Set<string>(),
    presets: AbrImportedPreset[] = [],
    warnings: string[] = []
  const collectRefs = (shape: AbrBrush['shape']) => {
    if (shape.type === 'sampled') referenced.add(shape.sampledData)
  }
  for (const brush of abr.brushes) {
    collectRefs(brush.shape)
    if (brush.dualBrush) collectRefs(brush.dualBrush.shape)
  }

  abr.brushes.forEach((brush, index) => {
    const unsupported: string[] = [],
      settings: BrushPresetSettings = {}
    let sample: SampleInfo | undefined
    if (brush.shape.type === 'computed' || brush.shape.type === 'sampled') {
      settings.brushSize = clamp(brush.shape.size || 30, 1, 500, 30)
      settings.brushAngle = clamp(brush.shape.angle || 0, -180, 180, 0)
      settings.brushRoundness = percent(brush.shape.roundness, 1, 100, 100)
      settings.brushFlipX = brush.shape.flipX
      settings.brushFlipY = brush.shape.flipY
      settings.brushSpacing = brush.shape.spacingOn
        ? percent(brush.shape.spacing, 1, 1000, 15)
        : percent(brush.spacing, 1, 1000, 15)
      if (!brush.shape.spacingOn)
        unsupported.push('отключённый фиксированный интервал (зависимость от скорости)')
      if (brush.shape.type === 'computed') settings.brushHardness = percent(brush.shape.hardness)
      else {
        sample = byId.get(brush.shape.sampledData)
        if (!sample) {
          warnings.push(
            `«${brush.name || index + 1}»: не найден sampled-наконечник, кисть пропущена`,
          )
          return
        }
      }
    } else {
      warnings.push(
        `«${brush.name || index + 1}»: тип наконечника ${brush.shape.type} не поддерживается`,
      )
      return
    }
    dynamicsSettings(brush, settings, unsupported)
    if (brush.dualBrush) unsupported.push('двойная кисть')
    if (brush.texture) unsupported.push('текстура кисти')
    if (brush.colorDynamics) unsupported.push('цветовая динамика')
    if (brush.brushPose) unsupported.push('поза кисти/tilt')
    if (brush.noise) unsupported.push('шум кисти')
    if (brush.wetEdges) unsupported.push('влажные края')
    presets.push({
      id: brushPresetId(),
      name: (brush.name || `Кисть ${index + 1}`).slice(0, 80),
      settings: sanitizeBrushPresetSettings(settings),
      sample,
      unsupported: [...new Set(unsupported)],
    })
  })

  abr.samples.forEach((sample, index) => {
    if (referenced.has(sample.id)) return
    presets.push({
      id: brushPresetId(),
      name: `Наконечник ${index + 1}`,
      settings: {
        brushSize: clamp(Math.max(sample.bounds.w, sample.bounds.h), 1, 500, 30),
        brushSpacing: 15,
      },
      sample,
      unsupported: ['наконечник без связанного пресета в desc'],
    })
  })
  if (abr.patterns.length)
    warnings.push(
      `В ABR есть ${abr.patterns.length} текстурных узоров; текстура кисти пока не применяется`,
    )
  if (!presets.length) throw new Error('В ABR нет поддерживаемых круглых или sampled-кистей')
  return { presets, warnings, patternCount: abr.patterns.length }
}
