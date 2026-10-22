import { prepareAdjustmentRecords } from './psdAdjustments'
import { verifyProject } from './psdIntegrity'
import { decodeProject, encodeProject } from './psdMetadata'
import { initializeCanvas, readPsd, writePsd, type Psd } from 'ag-psd'
import { validatePsdHeader } from './psdHeader'
initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
)
self.onmessage = async (
  e: MessageEvent<
    | { operation: 'read'; buffer: ArrayBuffer }
    | { operation: 'read-composite'; buffer: ArrayBuffer }
    | { operation: 'write'; psd: Psd; psb: boolean; project?: unknown }
  >,
) => {
  try {
    if (e.data.operation === 'read-composite') {
      const header = validatePsdHeader(e.data.buffer)
      if (header.width * header.height > 8_388_608) throw new Error('Карта смещения PSD: до 8 Мп.')
      const psd = readPsd(e.data.buffer, {
        useImageData: true,
        skipThumbnail: true,
        skipLayerImageData: true,
        skipLinkedFilesData: true,
        totalMemoryLimit: 192 * 1024 * 1024,
      })
      if (!psd.imageData)
        throw new Error(
          'В PSD карты нет сводного изображения. Сохрани карту с Maximize Compatibility.',
        )
      const { width, height, data } = psd.imageData
      if (width !== header.width || height !== header.height || data.length !== width * height * 4)
        throw new Error('Некорректное сводное изображение PSD карты')
      const pixels = new Uint8ClampedArray(data)
      self.postMessage({ width, height, pixels }, { transfer: [pixels.buffer] })
    } else if (e.data.operation === 'read') {
      validatePsdHeader(e.data.buffer)
      const messages: string[] = []
      const psd = readPsd(e.data.buffer, {
        useImageData: true,
        skipThumbnail: true,
        skipLinkedFilesData: false,
        totalMemoryLimit: 192 * 1024 * 1024,
        logMissingFeatures: true,
        log: (...args: unknown[]) => {
          if (messages.length < 30) messages.push(args.map(String).join(' ').slice(0, 400))
        },
      })
      let project: unknown
      try {
        const integrity = await verifyProject(e.data.buffer)
        if (integrity === 'modified') messages.push('FSH777_STALE_XMP')
        else {
          project = decodeProject(psd.imageResources?.xmpMetadata)
          if (project && integrity === 'legacy') messages.push('FSH777_LEGACY_XMP')
        }
      } catch {
        messages.push('FSH777_INVALID_XMP')
      }
      const transfer = new Set<ArrayBuffer>()
      const collect = (v: unknown) => {
        if (ArrayBuffer.isView(v)) {
          if (v.buffer instanceof ArrayBuffer) transfer.add(v.buffer)
          return
        }
        if (v && typeof v === 'object') for (const value of Object.values(v)) collect(value)
      }
      collect(psd)
      self.postMessage({ psd, messages, project }, { transfer: [...transfer] })
    } else {
      if (e.data.project)
        e.data.psd.imageResources = {
          ...e.data.psd.imageResources,
          xmpMetadata: encodeProject(e.data.project, e.data.psd.imageResources?.xmpMetadata),
        }
      prepareAdjustmentRecords(e.data.psd.children || [])
      const buffer = writePsd(e.data.psd, {
        psb: e.data.psb,
        noBackground: true,
        invalidateTextLayers: false,
        trimImageData: false,
        compress: false,
      })
      self.postMessage({ buffer }, { transfer: [buffer] })
    }
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка формата PSD/PSB' })
  }
}
