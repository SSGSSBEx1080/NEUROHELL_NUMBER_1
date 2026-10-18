import type { Color, Layer as PsdLayer, Psd, PixelData } from 'ag-psd'
import type { BlendMode, EditorDocument } from '../types'
import { makeLayer, newDocument } from './document'
import { cacheImage, exportCanvas, prepareDocument, renderLayer } from './render'
import { defaultStyles, hasStyles } from './styles'
import { validatePsdHeader } from './psdHeader'
export interface CompatibilityReport { title: string; warnings: string[]; layerCount: number; format: string }
const blendToCanvas: Record<string, BlendMode> = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'soft light': 'soft-light', difference: 'difference', 'pass through': 'source-over' }
const blendToPsd: Record<BlendMode, PsdLayer['blendMode']> = { 'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'soft-light': 'soft light', difference: 'difference' }
function runCodec<T>(job: object, transfers: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./psd.worker.ts', import.meta.url), { type: 'module' })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('PSD/PSB: превышено время обработки. Попробуй файл меньшего размера.')) }, 60000)
    const finish = () => { clearTimeout(timer); worker.terminate() }
    worker.onmessage = ({ data }) => { finish(); if (data.error) reject(new Error(data.error)); else resolve(data) }
    worker.onerror = () => { finish(); reject(new Error('Не удалось обработать PSD/PSB. Проверь формат и размер файла.')) }
    worker.postMessage(job, transfers)
  })
}
const colorHex = (c?: Color, fallback = '#ffffff') => {
  if (!c) return fallback
  if ('r' in c) return '#' + [c.r, c.g, c.b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
  return fallback
}
const imageCanvas = (data: PixelData) => {
  if (data.width < 1 || data.height < 1 || data.width > 8192 || data.height > 8192 || data.width * data.height > 24_000_000) throw new Error('Слишком большой растровый слой в PSD/PSB')
  const canvas = document.createElement('canvas'); canvas.width = data.width; canvas.height = data.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.data), data.width, data.height), 0, 0)
  return canvas
}
export async function importPsd(buffer: ArrayBuffer, name: string): Promise<{ document: EditorDocument; report: CompatibilityReport }> {
  const header = validatePsdHeader(buffer)
  const { psd, messages } = await runCodec<{ psd: Psd; messages: string[] }>({ operation: 'read', buffer }, [buffer])
  const doc = newDocument(psd.width, psd.height, name.replace(/\.(psd|psb)$/i, ''), 'transparent')
  const warnings = new Set<string>(['Рабочая копия использует sRGB. Исходные ICC-профили не применяются и не сохраняются: цвета могут отличаться.'])
  const visit = (items: PsdLayer[], parent = '', opacity = 1, hidden = false) => {
    for (const src of items) {
      if (src.children?.length) {
        warnings.add('Группы развёрнуты в отдельные слои. Изолированное смешивание групп и групповые эффекты могут выглядеть иначе.')
        visit(src.children, `${parent}${src.name || 'Группа'} / `, opacity * (src.opacity ?? 1), hidden || !!src.hidden); continue
      }
      if (doc.layers.length >= 100) throw new Error('В PSD/PSB больше 100 слоёв. Уменьши число слоёв перед импортом.')
      if (!src.imageData || !src.imageData.width || !src.imageData.height) {
        if (src.adjustment) warnings.add('Корректирующие слои без растрового представления не воспроизведены. Сверь вид с композитом оригинала.')
        else warnings.add('Пустые или нерастровые слои без пикселей пропущены.')
        continue
      }
      const canvas = imageCanvas(src.imageData)
      const mask = src.mask
      if (mask?.imageData && !mask.disabled) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!, pixels = ctx.getImageData(0, 0, canvas.width, canvas.height), m = mask.imageData
        const mx = (mask.left || 0) + (mask.positionRelativeToLayer ? src.left || 0 : 0), my = (mask.top || 0) + (mask.positionRelativeToLayer ? src.top || 0 : 0)
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const xx = x + (src.left || 0) - mx, yy = y + (src.top || 0) - my
          const alpha = xx >= 0 && yy >= 0 && xx < m.width && yy < m.height ? m.data[(yy * m.width + xx) * 4] : mask.defaultColor ?? 255
          pixels.data[(y * canvas.width + x) * 4 + 3] *= alpha / 255
        }
        ctx.putImageData(pixels, 0, 0); warnings.add('Растровые маски применены к пикселям; отдельно редактировать исходную маску нельзя.')
      }
      if (src.vectorMask || src.realMask) warnings.add('Векторные/составные маски могут не совпасть с оригиналом.')
      if (src.clipping) warnings.add('Обтравочные связи не поддерживаются: слои импортированы независимо.')
      if (src.placedLayer) warnings.add('Смарт-объекты импортированы как растровое представление. Вложенный документ и смарт-фильтры не редактируются.')
      if (src.text) warnings.add('Текст импортирован как растр для сохранения внешнего вида. Кнопка «Извлечь текст» создаёт редактируемый слой с заменой шрифта.')
      if (!blendToCanvas[src.blendMode || 'normal']) warnings.add('Некоторые режимы наложения заменены на «Обычный».')
      const dataUrl = canvas.toDataURL('image/png'); cacheImage(dataUrl, canvas)
      const layer = makeLayer({ kind: 'image', name: parent + (src.name || 'Слой'), x: src.left || 0, y: src.top || 0, width: canvas.width, height: canvas.height, src: dataUrl, opacity: opacity * (src.opacity ?? 1), visible: !(hidden || src.hidden), locked: !!(src.protected?.composite || src.protected?.position), blendMode: blendToCanvas[src.blendMode || 'normal'] || 'source-over', sourceText: src.text?.text?.replace(/\r\n?/g, '\n') })
      if (src.effects && !src.effects.disabled) {
        warnings.add('Базовые стили слоёв приближённо преобразованы. Для точного вида проверь композит оригинала.')
        const s = defaultStyles(), f = src.effects
        const stroke = f.stroke?.find(v => v.enabled !== false)
        if (stroke && (!stroke.fillType || stroke.fillType === 'color')) s.stroke = { enabled: true, size: Math.min(80, stroke.size?.value || 1), color: colorHex(stroke.color), position: stroke.position || 'outside' }
        const shadow = f.dropShadow?.find(v => v.enabled !== false)
        if (shadow) { const a = (shadow.angle || 0) * Math.PI / 180, distance = shadow.distance?.value || 0; s.shadow = { enabled: true, color: colorHex(shadow.color, '#000000'), opacity: shadow.opacity ?? 0.5, blur: Math.min(100, shadow.size?.value || 0), x: -Math.cos(a) * distance, y: Math.sin(a) * distance } }
        if (f.outerGlow && f.outerGlow.enabled !== false) s.glow = { enabled: true, color: colorHex(f.outerGlow.color), blur: Math.min(100, f.outerGlow.size?.value || 0), opacity: f.outerGlow.opacity ?? 0.5 }
        const overlay = f.solidFill?.find(v => v.enabled !== false)
        if (overlay) s.overlay = { enabled: true, color: colorHex(overlay.color), opacity: overlay.opacity ?? 1 }
        if (f.bevel || f.innerGlow || f.innerShadow || f.gradientOverlay || f.patternOverlay || f.satin) warnings.add('Тиснение, внутренние эффекты, градиентные/узорные стили PSD не перенесены; используйте композит или настройте свои стили.')
        layer.styles = s
      }
      doc.layers.push(layer)
    }
  }
  visit(psd.children || [])
  if (psd.imageData) {
    const canvas = imageCanvas(psd.imageData), src = canvas.toDataURL('image/png'); cacheImage(src, canvas)
    if (doc.layers.length < 100) {
      doc.layers.push(makeLayer({ kind: 'image', name: 'Оригинал · композит для сравнения', width: doc.width, height: doc.height, src, visible: !doc.layers.length, locked: true }))
      warnings.add('Вверху добавлен композит оригинала. Включи его глаз для сравнения; выключи, чтобы видеть редактируемые слои.')
    } else warnings.add('Композит для сравнения не добавлен: достигнут лимит 100 слоёв.')
  }
  if (!doc.layers.length) throw new Error('В файле не найдено доступных растровых слоёв или композита')
  if (messages.length) warnings.add('Декодер обнаружил неподдерживаемые метаданные. Это рабочая копия, а не сохранение исходного файла без потерь.')
  return { document: doc, report: { title: name, format: header.psb ? 'PSB' : 'PSD', warnings: [...warnings], layerCount: doc.layers.length } }
}
export async function exportPsd(doc: EditorDocument, psb: boolean): Promise<Blob> {
  await prepareDocument(doc)
  const composite = await exportCanvas(doc), children: PsdLayer[] = []
  let budget = doc.width * doc.height * 4
  if (doc.background !== 'transparent') {
    const c = document.createElement('canvas'); c.width = doc.width; c.height = doc.height
    const ctx = c.getContext('2d')!; ctx.fillStyle = doc.background; ctx.fillRect(0, 0, c.width, c.height)
    children.push({ name: 'Фон холста', left: 0, top: 0, imageData: ctx.getImageData(0, 0, c.width, c.height), opacity: 1 })
    budget += c.width * c.height * 4
  }
  for (const layer of doc.layers) {
    const angle = layer.rotation * Math.PI / 180, w = Math.abs(Math.cos(angle) * layer.width) + Math.abs(Math.sin(angle) * layer.height), h = Math.abs(Math.cos(angle) * layer.height) + Math.abs(Math.sin(angle) * layer.width)
    const pad = hasStyles(layer.styles) ? 380 : 2
    const left = layer.warp ? 0 : Math.max(0, Math.floor(layer.x + layer.width / 2 - w / 2 - pad)), top = layer.warp ? 0 : Math.max(0, Math.floor(layer.y + layer.height / 2 - h / 2 - pad))
    const right = layer.warp ? doc.width : Math.min(doc.width, Math.ceil(layer.x + layer.width / 2 + w / 2 + pad)), bottom = layer.warp ? doc.height : Math.min(doc.height, Math.ceil(layer.y + layer.height / 2 + h / 2 + pad))
    if (right <= left || bottom <= top) continue
    const width = right - left, height = bottom - top
    budget += width * height * 4
    if (budget > 192 * 1024 * 1024) throw new Error('Слишком много растровых данных для PSD/PSB. Сохрани .777 или объедини часть слоёв.')
    const c = document.createElement('canvas'); c.width = width; c.height = height
    const ctx = c.getContext('2d')!; ctx.translate(-left, -top)
    renderLayer(ctx, { ...layer, visible: true, opacity: 1, blendMode: 'source-over' })
    const output: PsdLayer = { name: layer.name, left, top, right, bottom, imageData: ctx.getImageData(0, 0, width, height), opacity: layer.opacity, hidden: !layer.visible, blendMode: blendToPsd[layer.blendMode], protected: { composite: layer.locked, position: layer.locked } }
    // Preserve simple native text metadata; complex styles are baked for consistent appearance.
    if (layer.kind === 'text' && !layer.warp && !hasStyles(layer.styles) && !layer.flipX && !layer.flipY && Object.values(layer.adjustments).every(v => v === 0)) {
      const rgb = [1, 3, 5].map(i => parseInt(layer.color.slice(i, i + 2), 16)), a = angle
      const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
      output.text = { text: (layer.text || '').replace(/\n/g, '\r'), transform: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx - Math.cos(a) * layer.width / 2 + Math.sin(a) * layer.height / 2, cy - Math.sin(a) * layer.width / 2 - Math.cos(a) * layer.height / 2], shapeType: 'box', boxBounds: [0, 0, layer.width, layer.height], style: { font: { name: layer.fontFamily || 'Manrope' }, fontSize: layer.fontSize || 48, horizontalScale: layer.textScaleX || 1, fauxBold: (layer.fontWeight || 400) >= 700, fauxItalic: layer.italic, fillColor: { r: rgb[0], g: rgb[1], b: rgb[2] }, leading: (layer.fontSize || 48) * (layer.lineHeight || 1.2), autoLeading: false, tracking: (layer.letterSpacing || 0) / (layer.fontSize || 48) * 1000 }, paragraphStyle: { justification: layer.textAlign || 'left' } }
    }
    children.push(output)
  }
  const imageData = composite.getContext('2d')!.getImageData(0, 0, doc.width, doc.height)
  const psd: Psd = { width: doc.width, height: doc.height, children, imageData }
  const { buffer } = await runCodec<{ buffer: ArrayBuffer }>({ operation: 'write', psd, psb })
  return new Blob([buffer], { type: 'application/octet-stream' })
}
