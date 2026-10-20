import type { EditorDocument } from '../types'
import { actionBlockers, runAction, type StudioAction } from './actions'
import { isLayerLocked, makeLayer, newDocument, parseProject } from './document'
import { downloadBlob, exportCanvas, loadImage, prepareDocument } from './render'
import {
  WORKING_RGB_PROFILE,
  buildIccProfile,
  builtinColorProfile,
  type ColorProfileModel,
} from './colorProfiles'
import { embedJpegIccProfile, embedPngIccProfile } from './imageIcc'
import { loadPreferences } from './preferences'

export type BatchFormat = 'png' | 'jpeg' | 'webp' | 'psd'
export interface BatchOptions {
  format: BatchFormat
  /** Inserted before the extension; output can never reuse the input name. */
  suffix: string
  quality: number
}
export interface BatchResult {
  name: string
  outputName?: string
  status: 'done' | 'error' | 'cancelled'
  message: string
}
export const MAX_BATCH_FILES = 50
const extensions: Record<BatchFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
  psd: 'psd',
}

export function sanitizeSuffix(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()
    .slice(0, 40)
  return cleaned || '-ultra'
}
export function batchOutputName(inputName: string, suffix: string, format: BatchFormat): string {
  const base = inputName.split(/[\\/]/).at(-1) || 'file'
  const stem = base.replace(/\.[^.]+$/, '') || 'file'
  const ext = extensions[format]
  let output = `${stem}${sanitizeSuffix(suffix)}.${ext}`
  if (output.toLowerCase() === base.toLowerCase()) output = `${stem}-copy.${ext}`
  return output
}
/** Actions start from the topmost eligible layer in every batch document. */
export function batchActionTarget(doc: EditorDocument): string | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i]
    if (layer.kind !== 'group' && layer.visible !== false && !isLayerLocked(doc, layer.id))
      return layer.id
  }
  return null
}
export function validateBatchAction(action: StudioAction | null) {
  if (!action) return
  const blockers = actionBlockers(action)
  if (blockers.length)
    throw new Error(
      `Операция «${action.name}» содержит неподдерживаемые шаги (${blockers.map((s) => s.name).join(', ')}) — пакет не запущен, чтобы не делать вид полной обработки.`,
    )
  if (!action.steps.some((s) => s.enabled))
    throw new Error(`В операции «${action.name}» нет включённых шагов`)
}

async function documentFromImage(file: File): Promise<EditorDocument> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Изображение должно быть меньше 25 МБ')
  let src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const image = await loadImage(src)
  let w = image.width,
    h = image.height
  const downscale = Math.min(1, 4096 / w, 4096 / h)
  if (downscale < 1) {
    const buffer = document.createElement('canvas')
    buffer.width = Math.round(w * downscale)
    buffer.height = Math.round(h * downscale)
    buffer.getContext('2d')!.drawImage(image, 0, 0, buffer.width, buffer.height)
    src = buffer.toDataURL('image/png')
    w = buffer.width
    h = buffer.height
    await loadImage(src)
  }
  const name = file.name.replace(/\.[^.]+$/, '')
  const doc = newDocument(w, h, name, 'transparent')
  doc.layers = [makeLayer({ kind: 'image', name, src, width: w, height: h })]
  return doc
}
export async function documentFromBatchFile(file: File): Promise<EditorDocument> {
  if (/\.(psd|psb)$/i.test(file.name)) {
    if (file.size > 80 * 1024 * 1024) throw new Error('PSD/PSB: размер файла до 80 МБ')
    const [{ importPsd }, { applyDocumentColorDecision }] = await Promise.all([
      import('./psd'),
      import('./documentColor'),
    ])
    const result = await importPsd(await file.arrayBuffer(), file.name)
    const color = result.report.color
    const prefs = loadPreferences()
    const options = {
      intent: prefs.colorIntent,
      blackPointCompensation: prefs.colorBlackPoint,
      dither: prefs.colorDither,
    }
    // Batch cannot stop for a Photoshop-style question. The safe appearance-
    // preserving default is conversion; explicit discard/assign policies win.
    if (color.status === 'mismatch' && color.sourceModel) {
      if (prefs.colorMismatchPolicy === 'discard')
        return applyDocumentColorDecision(result.document, {
          action: 'discard',
          sourceLabel: color.embeddedName,
        })
      if (prefs.colorMismatchPolicy === 'assign-working')
        return applyDocumentColorDecision(result.document, {
          action: 'assign-working',
          sourceLabel: color.embeddedName,
        })
      return applyDocumentColorDecision(result.document, {
        action: 'convert',
        source: color.sourceModel,
        ...options,
      })
    }
    if (color.status === 'unsupported' || color.status === 'mode-mismatch')
      return applyDocumentColorDecision(result.document, {
        action: 'discard',
        sourceLabel: color.embeddedName,
      })
    if (color.status === 'missing') {
      if (prefs.colorMissingPolicy === 'leave') return result.document
      if (color.mode === 'grayscale') {
        const assigned = builtinColorProfile(prefs.colorGrayProfile) as ColorProfileModel
        return applyDocumentColorDecision(result.document, {
          action: 'assign-and-convert',
          assigned,
          ...options,
        })
      }
      return applyDocumentColorDecision(result.document, { action: 'assign-working' })
    }
    return result.document
  }
  if (/\.(777|fsh777)$/i.test(file.name)) {
    if (file.size > 50 * 1024 * 1024) throw new Error('Проект должен быть меньше 50 МБ')
    return parseProject(JSON.parse(await file.text()))
  }
  if (
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    /\.(png|jpe?g|webp)$/i.test(file.name)
  )
    return documentFromImage(file)
  throw new Error('Поддерживаются PNG, JPEG, WebP, PSD, PSB и проекты .777')
}
async function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось закодировать изображение'))),
      type,
      quality,
    ),
  )
}
export async function exportBatchDocument(
  doc: EditorDocument,
  options: BatchOptions,
): Promise<Blob> {
  if (options.format === 'psd') {
    const { exportPsd } = await import('./psd')
    return exportPsd(doc, false, 0)
  }
  const canvas =
    options.format === 'jpeg' ? await exportCanvas(doc, 1, '#ffffff') : await exportCanvas(doc, 1)
  const type = options.format === 'png' ? 'image/png' : `image/${options.format}`
  const blob = await blobFromCanvas(canvas, type, Math.min(1, Math.max(0.1, options.quality)))
  if (
    (options.format === 'png' || options.format === 'jpeg') &&
    doc.colorProfile?.status !== 'untagged'
  ) {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const profile = buildIccProfile(WORKING_RGB_PROFILE)
    const tagged =
      options.format === 'png'
        ? await embedPngIccProfile(bytes, WORKING_RGB_PROFILE.name, profile)
        : embedJpegIccProfile(bytes, profile)
    return new Blob([tagged.slice()], { type })
  }
  return blob
}

/**
 * Sequential batch: one file at a time, per-file log, cancellation between files.
 * Input files are only read; outputs are new downloads (web) or new files inside
 * a user-picked folder that are never overwritten (desktop).
 */
export async function processBatch(
  files: File[],
  action: StudioAction | null,
  options: BatchOptions,
  hooks: {
    onResult?: (result: BatchResult, index: number, total: number) => void
    shouldCancel?: () => boolean
    folderId?: string
  } = {},
): Promise<BatchResult[]> {
  if (!files.length) throw new Error('Выбери хотя бы один файл')
  if (files.length > MAX_BATCH_FILES)
    throw new Error(`Пакет ограничен ${MAX_BATCH_FILES} файлами за запуск`)
  validateBatchAction(action)
  const results: BatchResult[] = []
  const usedNames = new Set<string>()
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (hooks.shouldCancel?.()) {
      const result: BatchResult = {
        name: file.name,
        status: 'cancelled',
        message: 'Отменено пользователем',
      }
      results.push(result)
      hooks.onResult?.(result, i, files.length)
      continue
    }
    try {
      let doc = await documentFromBatchFile(file)
      await prepareDocument(doc)
      if (action) {
        const target = batchActionTarget(doc)
        if (!target) throw new Error('Нет доступного слоя для операции')
        doc = runAction(doc, target, action).document
        await prepareDocument(doc)
      }
      const blob = await exportBatchDocument(doc, options)
      let outputName = batchOutputName(file.name, options.suffix, options.format)
      if (usedNames.has(outputName.toLowerCase()))
        outputName = batchOutputName(
          file.name,
          `${sanitizeSuffix(options.suffix)}-${i + 1}`,
          options.format,
        )
      usedNames.add(outputName.toLowerCase())
      if (hooks.folderId && window.fsh777?.saveBatchFile) {
        const saved = await window.fsh777.saveBatchFile({
          folderId: hooks.folderId,
          name: outputName,
          bytes: new Uint8Array(await blob.arrayBuffer()),
        })
        if (saved.state !== 'completed') throw new Error(saved.message || 'Запись отменена')
        outputName = saved.name
      } else {
        await downloadBlob(blob, outputName)
      }
      const result: BatchResult = {
        name: file.name,
        outputName,
        status: 'done',
        message: action ? `Операция «${action.name}» применена` : 'Конвертировано без операции',
      }
      results.push(result)
      hooks.onResult?.(result, i, files.length)
    } catch (error) {
      const result: BatchResult = {
        name: file.name,
        status: 'error',
        message: error instanceof Error ? error.message : 'Ошибка обработки файла',
      }
      results.push(result)
      hooks.onResult?.(result, i, files.length)
    }
  }
  return results
}
