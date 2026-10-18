import { sealProject } from './psdIntegrity'
import { affineText, exportNativeText, importNativeText } from './psdText'
import { exportVectorShape, importVectorShape, translateNativeVector } from './psdVector'
import { rasterBounds, rectPoints, worldBounds } from './layerGeometry'
import { layerPoint } from './shapeGeometry'
import { inspectNativeLayers, type PsdExportReport } from './psdReport'
import { DEFAULT_ADJUSTMENTS } from '../types'
import { preserveMergedPixels, preserveUnknownResources } from './psdBinary'
import type { Color, Layer as PsdLayer, LayerEffectsInfo, Psd, PixelData } from 'ag-psd'
import type { BlendMode, EditorDocument, Layer, LayerStyles } from '../types'
import { makeLayer, newDocument, parseProject, uid } from './document'
import {
  cacheImage,
  exportCanvas,
  filterString,
  loadImage,
  prepareDocument,
  renderLayer,
} from './render'
import { defaultStyles, hasStyles } from './styles'
import {
  isOriginalAppearance,
  isOriginalDocument,
  originalSource,
  registerSource,
  sameVisual,
} from './psdSource'
import { validatePsdHeader } from './psdHeader'
export interface CompatibilityReport {
  title: string
  warnings: string[]
  layerCount: number
  format: string
}
const toCanvas: Record<string, BlendMode> = {
  normal: 'source-over',
  'pass through': 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft light': 'soft-light',
  'hard light': 'hard-light',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'lighter',
}
const toPsd: Record<BlendMode, PsdLayer['blendMode']> = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'soft-light': 'soft light',
  'hard-light': 'hard light',
  'color-dodge': 'color dodge',
  'color-burn': 'color burn',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  lighter: 'linear dodge',
}
export function runCodec<T>(job: object, transfers: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new Error('PSD: превышено время обработки. Уменьши размер документа.'))
    }, 90000)
    const finish = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    worker.onmessage = ({ data }) => {
      finish()
      if (data.error) reject(new Error(data.error))
      else resolve(data)
    }
    worker.onerror = () => {
      finish()
      reject(new Error('Не удалось обработать PSD/PSB'))
    }
    worker.postMessage(job, transfers)
  })
}
const hex = (c?: Color, fallback = '#ffffff') =>
  !c || !('r' in c)
    ? fallback
    : '#' +
      [c.r, c.g, c.b]
        .map((v) =>
          Math.max(0, Math.min(255, Math.round(v)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
const rgb = (color: string) => ({
  r: parseInt(color.slice(1, 3), 16),
  g: parseInt(color.slice(3, 5), 16),
  b: parseInt(color.slice(5, 7), 16),
})
const px = (value: number) => ({ units: 'Pixels' as const, value })
function canvas(width: number, height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000)
    throw new Error('Слишком большой растровый слой PSD')
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}
function imageSource(data: PixelData) {
  const c = canvas(data.width, data.height)
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(data.data), data.width, data.height),
    0,
    0,
  )
  const src = c.toDataURL('image/png')
  cacheImage(src, c)
  return src
}
function importStyles(src: PsdLayer): LayerStyles | undefined {
  const f = src.effects,
    s = defaultStyles()
  s.fillOpacity = src.fillOpacity ?? 1
  if (f && !f.disabled) {
    const stroke = f.stroke?.find((v) => v.enabled !== false),
      shadow = f.dropShadow?.find((v) => v.enabled !== false),
      overlay = f.solidFill?.find((v) => v.enabled !== false),
      gradient = f.gradientOverlay?.find((v) => v.enabled !== false)
    if (stroke && (!stroke.fillType || stroke.fillType === 'color'))
      s.stroke = {
        enabled: true,
        size: Math.min(80, stroke.size?.value || 1),
        color: hex(stroke.color),
        position: stroke.position || 'outside',
      }
    if (shadow) {
      const a = ((shadow.angle || 0) * Math.PI) / 180,
        distance = shadow.distance?.value || 0
      s.shadow = {
        enabled: true,
        color: hex(shadow.color, '#000000'),
        opacity: shadow.opacity ?? 0.5,
        blur: Math.min(100, shadow.size?.value || 0),
        x: -Math.cos(a) * distance,
        y: Math.sin(a) * distance,
      }
    }
    if (f.outerGlow?.enabled !== false && f.outerGlow)
      s.glow = {
        enabled: true,
        color: hex(f.outerGlow.color),
        blur: Math.min(100, f.outerGlow.size?.value || 0),
        opacity: f.outerGlow.opacity ?? 0.5,
      }
    if (overlay)
      s.overlay = { enabled: true, color: hex(overlay.color), opacity: overlay.opacity ?? 1 }
    if (gradient?.gradient?.type === 'solid' && gradient.gradient.colorStops.length)
      s.gradient = {
        enabled: true,
        from: hex(gradient.gradient.colorStops[0].color),
        to: hex(gradient.gradient.colorStops.at(-1)!.color),
        angle: -(gradient.angle || 0),
        opacity: gradient.opacity ?? 1,
      }
  }
  return hasStyles(s) ? s : undefined
}
function exportStyles(s: LayerStyles): LayerEffectsInfo {
  const effects: LayerEffectsInfo = { scale: 1 }
  if (s.stroke.enabled)
    effects.stroke = [
      {
        enabled: true,
        position: s.stroke.position,
        fillType: 'color',
        size: px(s.stroke.size),
        color: rgb(s.stroke.color),
        opacity: 1,
        blendMode: 'normal',
      },
    ]
  if (s.shadow.enabled)
    effects.dropShadow = [
      {
        enabled: true,
        color: rgb(s.shadow.color),
        size: px(s.shadow.blur),
        distance: px(Math.hypot(s.shadow.x, s.shadow.y)),
        angle: (Math.atan2(s.shadow.y, -s.shadow.x) * 180) / Math.PI,
        opacity: s.shadow.opacity,
        blendMode: 'multiply',
        useGlobalLight: false,
      },
    ]
  if (s.glow.enabled)
    effects.outerGlow = {
      enabled: true,
      color: rgb(s.glow.color),
      size: px(s.glow.blur),
      opacity: s.glow.opacity,
      blendMode: 'screen',
    }
  if (s.overlay.enabled)
    effects.solidFill = [
      {
        enabled: true,
        color: rgb(s.overlay.color),
        opacity: s.overlay.opacity,
        blendMode: 'normal',
      },
    ]
  if (s.gradient.enabled)
    effects.gradientOverlay = [
      {
        enabled: true,
        type: 'linear',
        angle: -s.gradient.angle,
        opacity: s.gradient.opacity,
        blendMode: 'normal',
        scale: 1,
        align: true,
        gradient: {
          name: 'ФШ777',
          type: 'solid',
          smoothness: 1,
          colorStops: [
            { color: rgb(s.gradient.from), location: 0, midpoint: 0.5 },
            { color: rgb(s.gradient.to), location: 1, midpoint: 0.5 },
          ],
          opacityStops: [
            { opacity: 1, location: 0, midpoint: 0.5 },
            { opacity: 1, location: 1, midpoint: 0.5 },
          ],
        },
      },
    ]
  return effects
}
export async function importPsd(
  buffer: ArrayBuffer,
  name: string,
): Promise<{ document: EditorDocument; report: CompatibilityReport }> {
  const header = validatePsdHeader(buffer),
    original = buffer.slice(0)
  const { psd, messages, project } = await runCodec<{
    psd: Psd
    messages: string[]
    project?: unknown
  }>({ operation: 'read', buffer }, [buffer])
  const warnings = new Set<string>()
  if (messages.includes('FSH777_STALE_XMP'))
    warnings.add(
      'Файл изменён после сохранения ФШ777. Устаревший внутренний проект проигнорирован: читаются настоящие слои PSD, включая внешние изменения текста и фигур.',
    )
  if (messages.includes('FSH777_INVALID_XMP'))
    warnings.add(
      'Внутренние метаданные проекта повреждены или превышают лимит. Читаются настоящие слои PSD; исходный файл сохранён отдельно.',
    )
  if (messages.includes('FSH777_LEGACY_XMP'))
    warnings.add(
      'Это старый PSD ФШ777 без проверки целостности XMP. Для защиты от устаревших внутренних данных сохрани новую копию в текущей версии.',
    )
  let doc = newDocument(psd.width, psd.height, name.replace(/\.(psd|psb)$/i, ''), 'transparent')
  if (project) {
    const own = parseProject(project)
    if (own.width !== psd.width || own.height !== psd.height)
      throw new Error('Размеры встроенного проекта не совпадают с PSD')
    doc = { ...own, name: doc.name, sourceId: undefined }
    warnings.add(
      'Восстановлены редактируемые данные ФШ777 из стандартного XMP-блока. Файл также содержит обычные PSD-слои и объединённое изображение.',
    )
  } else {
    const visit = async (items: PsdLayer[], parentId?: string, path: number[] = []) => {
      for (const [index, src] of items.entries()) {
        if (doc.layers.length >= 100 || path.length > 12)
          throw new Error('До 100 слоёв и 12 уровней групп')
        const sourcePath = [...path, index],
          group = !!src.children
        const layer = makeLayer({
          kind: group ? 'group' : 'image',
          name: src.name || 'Слой',
          parentId,
          sourcePath,
          x: src.left ?? 0,
          y: src.top ?? 0,
          width: group ? doc.width : src.imageData?.width || 1,
          height: group ? doc.height : src.imageData?.height || 1,
          opacity: src.opacity ?? 1,
          visible: !src.hidden,
          locked: !!(src.protected?.composite || src.protected?.position),
          blendMode: toCanvas[src.blendMode || 'normal'] || 'source-over',
          expanded: src.opened !== false,
          isolated: src.blendMode !== 'pass through',
          clipping: src.clipping,
          sourceText: src.text?.text?.replace(/\r\n?/g, '\n'),
          styles: importStyles(src),
        })
        if (!group) {
          if (src.imageData?.width && src.imageData.height) layer.src = imageSource(src.imageData)
          else {
            layer.src = canvas(1, 1).toDataURL()
            warnings.add(
              'Нерастровые/корректирующие слои без пикселей сохранены в структуре PSD, но не вычисляются рабочим рендерером.',
            )
          }
        }
        const editableShape = !group ? importVectorShape(src) : undefined
        const editableText = src.text
          ? await importNativeText(src.text, layer, (s) => warnings.add(s))
          : undefined
        if (editableText) Object.assign(layer, editableText)
        if (editableShape) Object.assign(layer, editableShape)
        else if (src.vectorFill && src.vectorMask)
          warnings.add(
            'Часть векторных фигур использует неподдерживаемую заливку или логические операции контуров: исходная структура сохраняется, предпросмотр растровый.',
          )
        if (src.mask?.imageData && !(editableShape && src.mask.fromVectorData)) {
          const m = src.mask,
            data = m.imageData!
          layer.mask = {
            src: imageSource(data),
            x: (m.left || 0) + (m.positionRelativeToLayer ? src.left || 0 : 0),
            y: (m.top || 0) + (m.positionRelativeToLayer ? src.top || 0 : 0),
            width: data.width,
            height: data.height,
            enabled: !m.disabled,
            linked: true,
            defaultColor: m.defaultColor ?? 255,
            density: m.userMaskDensity ?? 1,
            feather: m.userMaskFeather || 0,
          }
        }
        doc.layers.push(layer)
        if (group) await visit(src.children!, layer.id, sourcePath)
        if (src.effects)
          warnings.add(
            'Исходные эффекты сохраняются для неизменённого содержимого слоёв. Их рабочий предпросмотр может отличаться; до первого изменения показывается исходный композит.',
          )
        if (src.text && !editableText)
          warnings.add(
            'Сложный, вертикальный или неоднородно оформленный текст сохранён с исходными native-данными и пиксельным предпросмотром. «Извлечь текст» создаст редактируемую упрощённую копию; оригинал остаётся в PSD.',
          )
        if (src.placedLayer)
          warnings.add(
            'Исходные смарт-объекты и вложенные данные сохраняются при неизменённом содержимом. Поддерживаемый вложенный PSD можно открыть отдельно.',
          )
        if (
          (src.vectorMask && !editableShape) ||
          src.realMask ||
          !toCanvas[src.blendMode || 'normal']
        )
          warnings.add(
            'Сложные маски или режимы смешивания не полностью воспроизводятся после редактирования; не перезаписывай единственный оригинал.',
          )
      }
    }
    await visit(psd.children || [])
    if (!doc.layers.length && psd.imageData)
      doc.layers.push(
        makeLayer({
          kind: 'image',
          name: 'Объединённое изображение',
          width: doc.width,
          height: doc.height,
          src: imageSource(psd.imageData),
        }),
      )
    warnings.add(
      'Без правок PSD сохраняется побайтно, включая неизвестные данные и профили. После правок используется sRGB-предпросмотр; полная поддержка ICC/Adobe-эффектов не гарантируется.',
    )
    if (messages.length)
      warnings.add(
        'Декодер сообщил о неподдерживаемых метаданных. Неизменённый оригинал сохраняется целиком; после правок неизвестные блоки могут быть потеряны.',
      )
  }
  doc = parseProject({
    ...doc,
    dpi: psd.imageResources?.resolutionInfo?.horizontalResolution || doc.dpi || 72,
    sourceId: uid(),
  })
  const composite = psd.imageData ? imageSource(psd.imageData) : undefined
  if (
    !(await registerSource({
      id: doc.sourceId!,
      bytes: original,
      baseline: doc,
      composite,
      psb: header.psb,
    }))
  )
    warnings.add(
      'Исходные байты PSD не записаны в локальное хранилище. Сохрани отдельный файл; после перезапуска побайтное восстановление оригинала не гарантируется.',
    )
  return {
    document: doc,
    report: {
      title: name,
      format: header.psb ? 'PSB' : 'PSD',
      warnings: [...warnings],
      layerCount: doc.layers.length,
    },
  }
}
function layerAt(psd: Psd | undefined, path?: number[]): PsdLayer | undefined {
  let children = psd?.children,
    layer: PsdLayer | undefined
  for (const index of path || []) {
    layer = children?.[index]
    children = layer?.children
  }
  return layer
}
function unchangedContent(a: Layer, b?: Layer) {
  if (!b) return false
  // Translation and compositing can be updated without rasterizing native type/masks/effects.
  const clean = (l: Layer) => ({
    ...l,
    x: 0,
    y: 0,
    opacity: 1,
    visible: true,
    parentId: undefined,
    blendMode: 'source-over',
    mask: undefined,
    styles: undefined,
    clipping: false,
  })
  return sameVisual(clean(a), clean(b))
}
/** Bake scalar colour adjustments into editable paint, never into the layer type. */
function nativePaint(layer: Layer): Layer {
  const adjusted = Object.entries(layer.adjustments).some(
    ([key, value]) => key !== 'blur' && value !== 0,
  )
  if (!adjusted) return { ...layer, adjustments: { ...DEFAULT_ADJUSTMENTS } }
  const c = canvas(3, 3),
    ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.filter = filterString({ ...layer, adjustments: { ...layer.adjustments, blur: 0 } })
  const color = (value: string) => {
    ctx.clearRect(0, 0, 3, 3)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 3, 3)
    const p = ctx.getImageData(1, 1, 1, 1).data
    return '#' + [...p.slice(0, 3)].map((n) => n.toString(16).padStart(2, '0')).join('')
  }
  return {
    ...layer,
    color: color(layer.color),
    strokeColor: layer.strokeColor ? color(layer.strokeColor) : undefined,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
  }
}
export async function exportPsd(
  doc: EditorDocument,
  psb = false,
  depth = 0,
  report?: (summary: PsdExportReport) => void,
): Promise<Blob> {
  if (depth > 3) throw new Error('Слишком глубокий смарт-объект')
  await prepareDocument(doc)
  const source = originalSource(doc)
  if (source && source.psb === psb && isOriginalDocument(doc)) {
    report?.({
      ...inspectNativeLayers({ width: doc.width, height: doc.height }, []),
      original: true,
    })
    return new Blob([source.bytes], { type: 'image/vnd.adobe.photoshop' })
  }
  let original: Psd | undefined
  if (source) {
    const copy = source.bytes.slice(0)
    original = (await runCodec<{ psd: Psd }>({ operation: 'read', buffer: copy }, [copy])).psd
  }
  const imageData =
    original?.imageData && isOriginalAppearance(doc)
      ? original.imageData
      : (await exportCanvas(doc)).getContext('2d')!.getImageData(0, 0, doc.width, doc.height)
  let budget = doc.width * doc.height * 4
  const allocate = (width: number, height: number) => {
    budget += width * height * 4
    if (budget > 192 * 1024 * 1024)
      throw new Error('PSD: более 192 МиБ растров. Объедини часть слоёв.')
    return canvas(width, height)
  }
  const notes: string[] = []
  let editableContents = 0
  const paths = new Map<string, number[]>(),
    linkedFiles = [...(original?.linkedFiles || [])]
  const build = async (
    parentId?: string,
    parentPath: number[] = [],
    rootOffset = 0,
  ): Promise<PsdLayer[]> => {
    const output: PsdLayer[] = []
    for (const layer of doc.layers.filter((l) => l.parentId === parentId)) {
      const path = [...parentPath, output.length + rootOffset]
      paths.set(layer.id, path)
      const before = source?.baseline.layers.find((l) => l.id === layer.id),
        raw = layerAt(original, layer.sourcePath)
      const preserved = raw && unchangedContent(layer, before)
      let out: PsdLayer = {}
      if (preserved) {
        out = { ...raw }
        const dx = Math.round(layer.x - before!.x),
          dy = Math.round(layer.y - before!.y)
        for (const key of ['left', 'right'] as const) if (out[key] !== undefined) out[key] += dx
        for (const key of ['top', 'bottom'] as const) if (out[key] !== undefined) out[key] += dy
        if (dx || dy) Object.assign(out, translateNativeVector(out, dx, dy))
        if (out.text && (dx || dy)) {
          const transform = [...(out.text.transform || [1, 0, 0, 1, 0, 0])]
          transform[4] += dx
          transform[5] += dy
          out.text = { ...out.text, transform }
        }
        if (out.placedLayer && (dx || dy))
          out.placedLayer = {
            ...out.placedLayer,
            transform: out.placedLayer.transform.map((n, i) => n + (i % 2 ? dy : dx)),
          }
      } else if (layer.kind !== 'group') {
        const bounds = worldBounds(layer, true)
        const left = Math.floor(bounds.x),
          top = Math.floor(bounds.y)
        const right = Math.ceil(bounds.x + bounds.width),
          bottom = Math.ceil(bounds.y + bounds.height)
        const c = allocate(right - left, bottom - top),
          ctx = c.getContext('2d')!
        ctx.translate(-left, -top)
        renderLayer(ctx, {
          ...layer,
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          styles: undefined,
          mask: undefined,
        })
        out = { left, top, right, bottom, imageData: ctx.getImageData(0, 0, c.width, c.height) }
        if (layer.kind === 'shape' || layer.kind === 'text') {
          const native = nativePaint(layer)
          if (Object.entries(layer.adjustments).some(([k, v]) => k !== 'blur' && v !== 0))
            notes.push(
              'Цветокоррекции текста и однотонных фигур пересчитаны в цвет редактируемой заливки/обводки. Исходные ползунки ФШ777 дополнительно хранятся в XMP.',
            )
          const embedded = !!layer.adjustments.blur || (layer.kind === 'text' && !affineText(layer))
          if (!embedded) {
            if (layer.kind === 'shape') Object.assign(out, exportVectorShape(native, doc.dpi || 72))
            else out.text = exportNativeText(native)
          } else {
            const bounds = rasterBounds({ ...native, flipX: false, flipY: false }, false)
            const inner = newDocument(
              Math.ceil(bounds.width),
              Math.ceil(bounds.height),
              layer.name,
              'transparent',
            )
            if (inner.width > 4096 || inner.height > 4096)
              throw new Error(
                'Редактируемый вложенный слой превышает 4096 px. Уменьши размер текста/фигуры перед экспортом сложного преобразования.',
              )
            inner.dpi = doc.dpi || 72
            inner.layers = [
              {
                ...native,
                id: uid(),
                x: -bounds.x,
                y: -bounds.y,
                rotation: 0,
                warp: undefined,
                flipX: false,
                flipY: false,
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'source-over',
                clipping: false,
                parentId: undefined,
                styles: undefined,
                mask: undefined,
                sourcePath: undefined,
                src: undefined,
                smart: undefined,
              },
            ]
            const nested = await exportPsd(inner, false, depth + 1),
              id = uid()
            linkedFiles.push({
              id,
              name: `${layer.name}.psd`,
              type: '8BPS',
              creator: '8BIM',
              data: new Uint8Array(await nested.arrayBuffer()),
            })
            const corners = rectPoints({
              ...bounds,
              width: inner.width,
              height: inner.height,
            }).flatMap((p) => {
              const q = layerPoint(layer, p)
              return [q.x, q.y]
            })
            out.placedLayer = {
              id,
              type: 'raster',
              width: inner.width,
              height: inner.height,
              transform: corners,
              nonAffineTransform: corners,
              resolution: { units: 'Density', value: inner.dpi },
              ...(layer.adjustments.blur
                ? {
                    filter: {
                      enabled: true,
                      validAtPosition: true,
                      maskEnabled: false,
                      maskLinked: false,
                      maskExtendWithWhite: true,
                      list: [
                        {
                          type: 'gaussian blur' as const,
                          filter: { radius: px(layer.adjustments.blur) },
                          name: 'Gaussian Blur',
                          opacity: 1,
                          blendMode: 'normal' as const,
                          enabled: true,
                          hasOptions: true,
                          foregroundColor: rgb('#000000'),
                          backgroundColor: rgb('#ffffff'),
                        },
                      ],
                    },
                  }
                : {}),
            }
            editableContents++
            notes.push(
              'Размытие или проективный текст сохранены в стандартном смарт-объекте с вложенным редактируемым PSD, а не сведены в единственную картинку. Открой содержимое смарт-объекта для правки текста/контуров; перерасчёт фильтра в другом редакторе может отличаться.',
            )
          }
        }
      }
      if (layer.kind === 'group') {
        out.children = await build(layer.id, path)
        out.opened = layer.expanded !== false
        out.blendMode = layer.isolated ? toPsd[layer.blendMode] : 'pass through'
      } else
        out.blendMode =
          preserved && before!.blendMode === layer.blendMode
            ? raw!.blendMode
            : toPsd[layer.blendMode]
      out.name = layer.name
      out.opacity = layer.opacity
      out.hidden = !layer.visible
      out.clipping = layer.clipping
      out.protected = { ...out.protected, composite: layer.locked, position: layer.locked }
      if (!preserved || !sameVisual(layer.styles, before?.styles)) {
        out.effects = layer.styles ? exportStyles(layer.styles) : undefined
        out.fillOpacity = layer.styles?.fillOpacity ?? 1
      }
      if (layer.mask) {
        const m = layer.mask,
          old = before?.mask
        const unchangedMask =
          preserved &&
          raw?.mask &&
          old &&
          sameVisual({ ...m, x: 0, y: 0, enabled: true }, { ...old, x: 0, y: 0, enabled: true }) &&
          Math.abs(m.x - old.x - (layer.x - before!.x)) < 0.001 &&
          Math.abs(m.y - old.y - (layer.y - before!.y)) < 0.001
        if (unchangedMask) {
          const sourceMask = raw!.mask!,
            dx = m.x - old!.x + (sourceMask.positionRelativeToLayer ? before!.x : 0),
            dy = m.y - old!.y + (sourceMask.positionRelativeToLayer ? before!.y : 0)
          out.mask = {
            ...sourceMask,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            left: (sourceMask.left || 0) + dx,
            top: (sourceMask.top || 0) + dy,
            right: (sourceMask.right || 0) + dx,
            bottom: (sourceMask.bottom || 0) + dy,
          }
        } else if (out.imageData && (layer.rotation || layer.warp || layer.flipX || layer.flipY)) {
          // PSD raster masks live in document coordinates, unlike our editable local
          // transform. Derive coverage from the same rendered pixels, not an unrotated
          // mask rectangle. Keep hidden source pixels and an independent native mask.
          // Density/feather are baked into this transformed mask; XMP retains the controls.
          const data = out.imageData,
            c = allocate(data.width, data.height),
            x = c.getContext('2d')!
          x.translate(-(out.left || 0), -(out.top || 0))
          renderLayer(x, {
            ...layer,
            visible: true,
            opacity: 1,
            blendMode: 'source-over',
            styles: undefined,
            mask: { ...m, enabled: true },
          })
          const masked = x.getImageData(0, 0, c.width, c.height),
            maskPixels = new Uint8ClampedArray(masked.data.length)
          for (let i = 0; i < maskPixels.length; i += 4) {
            const alpha = m.enabled
              ? Math.max(data.data[i + 3], masked.data[i + 3])
              : data.data[i + 3]
            if (m.enabled && masked.data[i + 3]) {
              data.data[i] = masked.data[i]
              data.data[i + 1] = masked.data[i + 1]
              data.data[i + 2] = masked.data[i + 2]
            }
            data.data[i + 3] = alpha
            const coverage = alpha ? Math.round((masked.data[i + 3] * 255) / alpha) : 0
            maskPixels[i] = maskPixels[i + 1] = maskPixels[i + 2] = coverage
            maskPixels[i + 3] = 255
          }
          out.mask = {
            left: out.left,
            top: out.top,
            right: out.right,
            bottom: out.bottom,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            defaultColor: 0,
            userMaskDensity: 1,
            userMaskFeather: 0,
            imageData: { width: c.width, height: c.height, data: maskPixels },
          }
        } else {
          const img = await loadImage(m.src),
            c = allocate(Math.max(1, Math.round(m.width)), Math.max(1, Math.round(m.height)))
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
          out.mask = {
            ...out.mask,
            left: Math.round(m.x),
            top: Math.round(m.y),
            right: Math.round(m.x) + c.width,
            bottom: Math.round(m.y) + c.height,
            disabled: !m.enabled,
            positionRelativeToLayer: false,
            defaultColor: m.defaultColor,
            userMaskDensity: m.density,
            userMaskFeather: m.feather,
            imageData: c.getContext('2d')!.getImageData(0, 0, c.width, c.height),
          }
        }
      } else out.mask = undefined
      if (layer.smart && !preserved) {
        const nested = await exportPsd({ ...layer.smart, sourceId: undefined }, false, depth + 1),
          id = uid()
        linkedFiles.push({
          id,
          name: `${layer.name}.psd`,
          type: '8BPS',
          creator: '8BIM',
          data: new Uint8Array(await nested.arrayBuffer()),
        })
        const a = (layer.rotation * Math.PI) / 180,
          cx = layer.x + layer.width / 2,
          cy = layer.y + layer.height / 2
        const quad = layer.warp || [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ]
        const order =
          layer.flipX && layer.flipY
            ? [2, 3, 0, 1]
            : layer.flipX
              ? [1, 0, 3, 2]
              : layer.flipY
                ? [3, 2, 1, 0]
                : [0, 1, 2, 3]
        const corners = order
          .map((i) => quad[i])
          .flatMap((p) => {
            const x = (p.x - 0.5) * layer.width,
              y = (p.y - 0.5) * layer.height
            return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]
          })
        out.placedLayer = {
          id,
          type: 'raster',
          width: layer.smart.width,
          height: layer.smart.height,
          transform: corners,
          resolution: { units: 'Density', value: layer.smart.dpi || 72 },
        }
      }
      output.push(out)
    }
    return output
  }
  const children: PsdLayer[] = []
  if (doc.background !== 'transparent') {
    const c = allocate(doc.width, doc.height),
      ctx = c.getContext('2d')!
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, c.width, c.height)
    children.push({
      name: 'Фон холста',
      imageData: ctx.getImageData(0, 0, c.width, c.height),
      left: 0,
      top: 0,
    })
  }
  children.push(...(await build(undefined, [], children.length)))
  const portable = {
    ...doc,
    sourceId: undefined,
    layers: await Promise.all(
      doc.layers.map(async (l) => {
        let src = l.src
        if (src?.startsWith('/')) {
          const img = await loadImage(src),
            c = canvas(img.width, img.height)
          c.getContext('2d')!.drawImage(img, 0, 0)
          src = c.toDataURL('image/png')
        }
        return { ...l, src, sourcePath: paths.get(l.id) }
      }),
    ),
  }
  const psd: Psd = {
    width: doc.width,
    height: doc.height,
    children,
    imageData,
    linkedFiles,
    imageResources: {
      ...original?.imageResources,
      versionInfo: {
        hasRealMergedData: true,
        writerName: 'ФШ777',
        readerName: 'ФШ777',
        fileVersion: 1,
      },
      resolutionInfo: {
        horizontalResolution: doc.dpi || 72,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: doc.dpi || 72,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches',
      },
    },
  }
  const summary = inspectNativeLayers(psd, notes, editableContents)
  if (summary.text || summary.editableContents)
    summary.warnings.push(
      'PSD не встраивает шрифты. Для одинаковой типографики они должны быть доступны принимающему редактору. Некоторые редакторы могут предложить обновить текстовый движок.',
    )
  const { buffer } = await runCodec<{ buffer: ArrayBuffer }>({
    operation: 'write',
    psd,
    psb,
    project: portable,
  })
  const bytes =
    source && isOriginalAppearance(doc)
      ? preserveMergedPixels(source.bytes, preserveUnknownResources(source.bytes, buffer))
      : buffer
  if (bytes.byteLength > 80 * 1024 * 1024)
    throw new Error(
      'PSD превышает 80 МБ — лимит повторного открытия. Уменьши изображения или объедини слои.',
    )
  await sealProject(bytes)
  report?.(summary)
  return new Blob([bytes], { type: 'image/vnd.adobe.photoshop' })
}
