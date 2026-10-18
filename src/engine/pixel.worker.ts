import { processPixels, type PixelRequest } from './pixels'

self.onmessage = (event: MessageEvent<PixelRequest & { id: number }>) => {
  const { id, ...request } = event.data
  try {
    const pixels = processPixels(request)
    self.postMessage({ id, pixels }, { transfer: [pixels.buffer] })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Ошибка обработки' })
  }
}
