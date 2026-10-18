import { decodeProject, encodeProject } from './psdMetadata'
import { initializeCanvas, readPsd, writePsd, type Psd } from 'ag-psd'
import { validatePsdHeader } from './psdHeader'
initializeCanvas(
  (width, height) => new OffscreenCanvas(width, height) as unknown as HTMLCanvasElement,
)
self.onmessage = (
  e: MessageEvent<
    | { operation: 'read'; buffer: ArrayBuffer }
    | { operation: 'write'; psd: Psd; psb: boolean; project?: unknown }
  >,
) => {
  try {
    if (e.data.operation === 'read') {
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
      const transfer = new Set<ArrayBuffer>()
      const collect = (v: unknown) => {
        if (ArrayBuffer.isView(v)) {
          if (v.buffer instanceof ArrayBuffer) transfer.add(v.buffer)
          return
        }
        if (v && typeof v === 'object') for (const value of Object.values(v)) collect(value)
      }
      collect(psd)
      self.postMessage(
        { psd, messages, project: decodeProject(psd.imageResources?.xmpMetadata) },
        { transfer: [...transfer] },
      )
    } else {
      if (e.data.project)
        e.data.psd.imageResources = {
          ...e.data.psd.imageResources,
          xmpMetadata: encodeProject(e.data.project, e.data.psd.imageResources?.xmpMetadata),
        }
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
