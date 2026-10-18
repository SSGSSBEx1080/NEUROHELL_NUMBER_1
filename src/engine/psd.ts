import { preserveMergedPixels } from './psdBinary'
import type { Color, Layer as PsdLayer, LayerEffectsInfo, Psd, PixelData } from 'ag-psd'
import type { BlendMode, EditorDocument, Layer, LayerStyles } from '../types'
import { makeLayer, newDocument, parseProject, uid } from './document'
import { cacheImage, exportCanvas, loadImage, prepareDocument, renderLayer } from './render'
import { defaultStyles, hasStyles } from './styles'
import { isOriginalAppearance, isOriginalDocument, originalSource, registerSource, sameVisual } from './psdSource'
import { validatePsdHeader } from './psdHeader'
export interface CompatibilityReport { title: string; warnings: string[]; layerCount: number; format: string }
const toCanvas: Record<string, BlendMode> = { normal: 'source-over', 'pass through': 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'soft light': 'soft-light', 'hard light': 'hard-light', 'color dodge': 'color-dodge', 'color burn': 'color-burn', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity', 'linear dodge': 'lighter' }
const toPsd: Record<BlendMode, PsdLayer['blendMode']> = { 'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'soft-light': 'soft light', 'hard-light': 'hard light', 'color-dodge': 'color dodge', 'color-burn': 'color burn', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity', lighter: 'linear dodge' }
export function runCodec<T>(job: object, transfers: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('PSD: превышено время обработки. Уменьши размер документа.')) }, 90000)
    const finish = () => { clearTimeout(timer); worker.terminate() }
    worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data) }
    worker.onerror = () => { finish(); reject(new Error('Не удалось обработать PSD/PSB')) }
    worker.postMessage(job, transfers)
  })
}
const hex = (c?: Color, fallback = '#ffffff') => !c || !('r' in c) ? fallback : '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const rgb = (color: string) => ({ r: parseInt(color.slice(1, 3), 16), g: parseInt(color.slice(3, 5), 16), b: parseInt(color.slice(5, 7), 16) })
const px = (value: number) => ({ units: 'Pixels' as const, value })
function canvas(width: number, height: number) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error('Слишком большой растровый слой PSD')
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c
}
function imageSource(data: PixelData) {
  const c = canvas(data.width, data.height); c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0)
  const src = c.toDataURL('image/png'); cacheImage(src, c); return src
}
function importStyles(src: PsdLayer): LayerStyles | undefined {
  const f = src.effects, s = defaultStyles(); s.fillOpacity = src.fillOpacity ?? 1
  if (f && !f.disabled) {
    const stroke = f.stroke?.find(v => v.enabled !== false), shadow = f.dropShadow?.find(v => v.enabled !== false), overlay = f.solidFill?.find(v => v.enabled !== false), gradient = f.gradientOverlay?.find(v => v.enabled !== false)
    if (stroke && (!stroke.fillType || stroke.fillType === 'color')) s.stroke = { enabled: true, size: Math.min(80, stroke.size?.value || 1), color: hex(stroke.color), position: stroke.position || 'outside' }
    if (shadow) { const a = (shadow.angle || 0) * Math.PI / 180, distance = shadow.distance?.value || 0; s.shadow = { enabled: true, color: hex(shadow.color, '#000000'), opacity: shadow.opacity ?? .5, blur: Math.min(100, shadow.size?.value || 0), x: -Math.cos(a) * distance, y: Math.sin(a) * distance } }
    if (f.outerGlow?.enabled !== false && f.outerGlow) s.glow = { enabled: true, color: hex(f.outerGlow.color), blur: Math.min(100, f.outerGlow.size?.value || 0), opacity: f.outerGlow.opacity ?? .5 }
    if (overlay) s.overlay = { enabled: true, color: hex(overlay.color), opacity: overlay.opacity ?? 1 }
    if (gradient?.gradient?.type === 'solid' && gradient.gradient.colorStops.length) s.gradient = { enabled: true, from: hex(gradient.gradient.colorStops[0].color), to: hex(gradient.gradient.colorStops.at(-1)!.color), angle: -(gradient.angle || 0), opacity: gradient.opacity ?? 1 }
  }
  return hasStyles(s) ? s : undefined
}
function exportStyles(s: LayerStyles): LayerEffectsInfo {
  const effects: LayerEffectsInfo = { scale: 1 }
  if (s.stroke.enabled) effects.stroke = [{ enabled: true, position: s.stroke.position, fillType: 'color', size: px(s.stroke.size), color: rgb(s.stroke.color), opacity: 1, blendMode: 'normal' }]
  if (s.shadow.enabled) effects.dropShadow = [{ enabled: true, color: rgb(s.shadow.color), size: px(s.shadow.blur), distance: px(Math.hypot(s.shadow.x, s.shadow.y)), angle: Math.atan2(s.shadow.y, -s.shadow.x) * 180 / Math.PI, opacity: s.shadow.opacity, blendMode: 'multiply', useGlobalLight: false }]
  if (s.glow.enabled) effects.outerGlow = { enabled: true, color: rgb(s.glow.color), size: px(s.glow.blur), opacity: s.glow.opacity, blendMode: 'screen' }
  if (s.overlay.enabled) effects.solidFill = [{ enabled: true, color: rgb(s.overlay.color), opacity: s.overlay.opacity, blendMode: 'normal' }]
  if (s.gradient.enabled) effects.gradientOverlay = [{ enabled: true, type: 'linear', angle: -s.gradient.angle, opacity: s.gradient.opacity, blendMode: 'normal', scale: 1, align: true, gradient: { name: 'ФШ777', type: 'solid', smoothness: 1, colorStops: [{ color: rgb(s.gradient.from), location: 0, midpoint: .5 }, { color: rgb(s.gradient.to), location: 1, midpoint: .5 }], opacityStops: [{ opacity: 1, location: 0, midpoint: .5 }, { opacity: 1, location: 1, midpoint: .5 }] } }]
  return effects
}
export async function importPsd(buffer: ArrayBuffer, name: string): Promise<{ document: EditorDocument; report: CompatibilityReport }> {
  const header = validatePsdHeader(buffer), original = buffer.slice(0)
  const { psd, messages, project } = await runCodec<{ psd: Psd; messages: string[]; project?: unknown }>({ operation: 'read', buffer }, [buffer])
  const warnings = new Set<string>()
  let doc = newDocument(psd.width, psd.height, name.replace(/\.(psd|psb)$/i, ''), 'transparent')
  if (project) {
    const own = parseProject(project)
    if (own.width !== psd.width || own.height !== psd.height) throw new Error('Размеры встроенного проекта не совпадают с PSD')
    doc = { ...own, name: doc.name, sourceId: undefined }
    warnings.add('Восстановлены редактируемые данные ФШ777 из стандартного XMP-блока. Файл также содержит обычные PSD-слои и объединённое изображение.')
  } else {
    const visit = (items: PsdLayer[], parentId?: string, path: number[] = []) => {
      for (const [index, src] of items.entries()) {
        if (doc.layers.length >= 100 || path.length > 12) throw new Error('До 100 слоёв и 12 уровней групп')
        const sourcePath = [...path, index], group = !!src.children
        const layer = makeLayer({ kind: group ? 'group' : 'image', name: src.name || 'Слой', parentId, sourcePath, x: src.left ?? 0, y: src.top ?? 0, width: group ? doc.width : src.imageData?.width || 1, height: group ? doc.height : src.imageData?.height || 1, opacity: src.opacity ?? 1, visible: !src.hidden, locked: !!(src.protected?.composite || src.protected?.position), blendMode: toCanvas[src.blendMode || 'normal'] || 'source-over', expanded: src.opened !== false, isolated: src.blendMode !== 'pass through', clipping: src.clipping, sourceText: src.text?.text?.replace(/\r\n?/g, '\n'), styles: importStyles(src) })
        if (!group) {
          if (src.imageData?.width && src.imageData.height) layer.src = imageSource(src.imageData)
          else { layer.src = canvas(1, 1).toDataURL(); warnings.add('Нерастровые/корректирующие слои без пикселей сохранены в структуре PSD, но не вычисляются рабочим рендерером.') }
        }
        if (src.mask?.imageData) {
          const m = src.mask, data = m.imageData!
          layer.mask = { src: imageSource(data), x: (m.left || 0) + (m.positionRelativeToLayer ? layer.x : 0), y: (m.top || 0) + (m.positionRelativeToLayer ? layer.y : 0), width: data.width, height: data.height, enabled: !m.disabled, linked: true, defaultColor: m.defaultColor ?? 255, density: m.userMaskDensity ?? 1, feather: m.userMaskFeather || 0 }
        }
        doc.layers.push(layer)
        if (group) visit(src.children!, layer.id, sourcePath)
        if (src.effects) warnings.add('Исходные эффекты сохраняются для неизменённого содержимого слоёв. Их рабочий предпросмотр может отличаться; до первого изменения показывается исходный композит.')
        if (src.text) warnings.add('Импортированный текст сохраняет исходные пиксели и текстовые данные PSD. «Извлечь текст» создаёт собственный редактируемый текст с подбором шрифта.')
        if (src.placedLayer) warnings.add('Исходные смарт-объекты и вложенные данные сохраняются при неизменённом содержимом. Поддерживаемый вложенный PSD можно открыть отдельно.')
        if (src.vectorMask || src.realMask || !toCanvas[src.blendMode || 'normal']) warnings.add('Сложные маски или режимы смешивания не полностью воспроизводятся после редактирования; не перезаписывай единственный оригинал.')
      }
    }
    visit(psd.children || [])
    if (!doc.layers.length && psd.imageData) doc.layers.push(makeLayer({ kind: 'image', name: 'Объединённое изображение', width: doc.width, height: doc.height, src: imageSource(psd.imageData) }))
    warnings.add('Без правок PSD сохраняется побайтно, включая неизвестные данные и профили. После правок используется sRGB-предпросмотр; полная поддержка ICC/Adobe-эффектов не гарантируется.')
    if (messages.length) warnings.add('Декодер сообщил о неподдерживаемых метаданных. Неизменённый оригинал сохраняется целиком; после правок неизвестные блоки могут быть потеряны.')
  }
  doc = parseProject({ ...doc, dpi: psd.imageResources?.resolutionInfo?.horizontalResolution || doc.dpi || 72, sourceId: uid() })
  const composite = psd.imageData ? imageSource(psd.imageData) : undefined
  await registerSource({ id: doc.sourceId!, bytes: original, baseline: doc, composite, psb: header.psb })
  return { document: doc, report: { title: name, format: header.psb ? 'PSB' : 'PSD', warnings: [...warnings], layerCount: doc.layers.length } }
}
function layerAt(psd: Psd | undefined, path?: number[]): PsdLayer | undefined {
  let children = psd?.children, layer: PsdLayer | undefined
  for (const index of path || []) { layer = children?.[index]; children = layer?.children }
  return layer
}
function unchangedContent(a: Layer, b?: Layer) {
  if (!b) return false
  // Translation and compositing can be updated without rasterizing native type/masks/effects.
  const clean = (l: Layer) => ({ ...l, x: 0, y: 0, opacity: 1, visible: true, parentId: undefined, blendMode: 'source-over', mask: undefined, styles: undefined, clipping: false })
  return sameVisual(clean(a), clean(b))
}
export async function exportPsd(doc: EditorDocument, psb = false, depth = 0): Promise<Blob> {
  if (depth > 3) throw new Error('Слишком глубокий смарт-объект')
  await prepareDocument(doc)
  const source = originalSource(doc)
  if (source && source.psb === psb && isOriginalDocument(doc)) return new Blob([source.bytes], { type: 'image/vnd.adobe.photoshop' })
  let original: Psd | undefined
  if (source) {
    const copy = source.bytes.slice(0)
    original = (await runCodec<{ psd: Psd }>({ operation: 'read', buffer: copy }, [copy])).psd
  }
  const imageData = original?.imageData && isOriginalAppearance(doc) ? original.imageData : (await exportCanvas(doc)).getContext('2d')!.getImageData(0, 0, doc.width, doc.height)
  let budget = doc.width * doc.height * 4
  const allocate = (width: number, height: number) => { budget += width * height * 4; if (budget > 192 * 1024 * 1024) throw new Error('PSD: более 192 МиБ растров. Объедини часть слоёв.'); return canvas(width, height) }
  const paths = new Map<string, number[]>(), linkedFiles = [...(original?.linkedFiles || [])]
  const build = async (parentId?: string, parentPath: number[] = [], rootOffset = 0): Promise<PsdLayer[]> => {
    const output: PsdLayer[] = []
    for (const layer of doc.layers.filter(l => l.parentId === parentId)) {
      const path = [...parentPath, output.length + rootOffset]; paths.set(layer.id, path)
      const before = source?.baseline.layers.find(l => l.id === layer.id), raw = layerAt(original, layer.sourcePath)
      const preserved = raw && unchangedContent(layer, before)
      let out: PsdLayer = {}
      if (preserved) {
        out = { ...raw }
        const dx = Math.round(layer.x - before!.x), dy = Math.round(layer.y - before!.y)
        for (const key of ['left', 'right'] as const) if (out[key] !== undefined) out[key] += dx
        for (const key of ['top', 'bottom'] as const) if (out[key] !== undefined) out[key] += dy
        if (out.text && (dx || dy)) { const transform = [...(out.text.transform || [1, 0, 0, 1, 0, 0])]; transform[4] += dx; transform[5] += dy; out.text = { ...out.text, transform } }
        if (out.placedLayer && (dx || dy)) out.placedLayer = { ...out.placedLayer, transform: out.placedLayer.transform.map((n, i) => n + (i % 2 ? dy : dx)) }
      } else if (layer.kind !== 'group') {
        const angle = layer.rotation * Math.PI / 180
        const padding = Math.ceil(layer.adjustments.blur * 3 + (layer.strokeWidth || 0) + 2)
        const corners = (layer.warp || [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).map(p => { const x = (p.x - .5) * layer.width, y = (p.y - .5) * layer.height; return { x: layer.x + layer.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: layer.y + layer.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) } })
        const left = Math.floor(Math.min(...corners.map(p => p.x)) - padding), top = Math.floor(Math.min(...corners.map(p => p.y)) - padding)
        const right = Math.ceil(Math.max(...corners.map(p => p.x)) + padding), bottom = Math.ceil(Math.max(...corners.map(p => p.y)) + padding)
        const c = allocate(right - left, bottom - top), ctx = c.getContext('2d')!; ctx.translate(-left, -top)
        renderLayer(ctx, { ...layer, visible: true, opacity: 1, blendMode: 'source-over', styles: undefined, mask: undefined })
        out = { left, top, right, bottom, imageData: ctx.getImageData(0, 0, c.width, c.height) }
        if (layer.kind === 'text' && !layer.warp && !layer.flipX && !layer.flipY && Object.values(layer.adjustments).every(v => v === 0)) {
          const a = angle, cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
          out.text = { text: (layer.text || '').replace(/\n/g, '\r'), transform: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx - Math.cos(a) * layer.width / 2 + Math.sin(a) * layer.height / 2, cy - Math.sin(a) * layer.width / 2 - Math.cos(a) * layer.height / 2], shapeType: 'box', boxBounds: [0, 0, layer.width, layer.height], style: { font: { name: layer.fontFamily || 'Manrope' }, fontSize: layer.fontSize || 48, horizontalScale: layer.textScaleX || 1, fauxBold: (layer.fontWeight || 400) >= 700, fauxItalic: layer.italic, fillColor: rgb(layer.color), leading: (layer.fontSize || 48) * (layer.lineHeight || 1.2), autoLeading: false, tracking: (layer.letterSpacing || 0) / (layer.fontSize || 48) * 1000 }, paragraphStyle: { justification: layer.textAlign || 'left' } }
        }
      }
      if (layer.kind === 'group') { out.children = await build(layer.id, path); out.opened = layer.expanded !== false; out.blendMode = layer.isolated ? toPsd[layer.blendMode] : 'pass through' }
      else out.blendMode = preserved && before!.blendMode === layer.blendMode ? raw!.blendMode : toPsd[layer.blendMode]
      out.name = layer.name; out.opacity = layer.opacity; out.hidden = !layer.visible; out.clipping = layer.clipping
      out.protected = { ...out.protected, composite: layer.locked, position: layer.locked }
      if (!preserved || !sameVisual(layer.styles, before?.styles)) { out.effects = layer.styles ? exportStyles(layer.styles) : undefined; out.fillOpacity = layer.styles?.fillOpacity ?? 1 }
      if (layer.mask) {
        const m = layer.mask, img = await loadImage(m.src), c = allocate(Math.max(1, Math.round(m.width)), Math.max(1, Math.round(m.height))); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        out.mask = { ...out.mask, left: Math.round(m.x), top: Math.round(m.y), right: Math.round(m.x) + c.width, bottom: Math.round(m.y) + c.height, disabled: !m.enabled, positionRelativeToLayer: false, defaultColor: m.defaultColor, userMaskDensity: m.density, userMaskFeather: m.feather, imageData: c.getContext('2d')!.getImageData(0, 0, c.width, c.height) }
      } else out.mask = undefined
      if (layer.smart && !preserved) {
        const nested = await exportPsd({ ...layer.smart, sourceId: undefined }, false, depth + 1), id = uid()
        linkedFiles.push({ id, name: `${layer.name}.psd`, type: '8BPS', creator: '8BIM', data: new Uint8Array(await nested.arrayBuffer()) })
        const a = layer.rotation * Math.PI / 180, cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
        const corners = (layer.warp || [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).flatMap(p => { const x = (p.x - .5) * layer.width, y = (p.y - .5) * layer.height; return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)] })
        out.placedLayer = { id, type: 'raster', width: layer.smart.width, height: layer.smart.height, transform: corners, resolution: { units: 'Density', value: layer.smart.dpi || 72 } }
      }
      output.push(out)
    }
    return output
  }
  const children: PsdLayer[] = []
  if (doc.background !== 'transparent') { const c = allocate(doc.width, doc.height), ctx = c.getContext('2d')!; ctx.fillStyle = doc.background; ctx.fillRect(0, 0, c.width, c.height); children.push({ name: 'Фон холста', imageData: ctx.getImageData(0, 0, c.width, c.height), left: 0, top: 0 }) }
  children.push(...await build(undefined, [], children.length))
  const portable = { ...doc, sourceId: undefined, layers: await Promise.all(doc.layers.map(async l => {
    let src = l.src
    if (src?.startsWith('/')) { const img = await loadImage(src), c = canvas(img.width, img.height); c.getContext('2d')!.drawImage(img, 0, 0); src = c.toDataURL('image/png') }
    return { ...l, src, sourcePath: paths.get(l.id) }
  })) }
  const psd: Psd = { width: doc.width, height: doc.height, children, imageData, linkedFiles, imageResources: { ...original?.imageResources, versionInfo: { hasRealMergedData: true, writerName: 'ФШ777', readerName: 'ФШ777', fileVersion: 1 }, resolutionInfo: { horizontalResolution: doc.dpi || 72, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: doc.dpi || 72, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } } }
  const { buffer } = await runCodec<{ buffer: ArrayBuffer }>({ operation: 'write', psd, psb, project: portable })
  if (buffer.byteLength > 80 * 1024 * 1024) throw new Error('PSD превышает 80 МБ — лимит повторного открытия. Уменьши изображения или объедини слои.')
  const bytes = source && isOriginalAppearance(doc) ? preserveMergedPixels(source.bytes, buffer) : buffer
  return new Blob([bytes], { type: 'image/vnd.adobe.photoshop' })
}
