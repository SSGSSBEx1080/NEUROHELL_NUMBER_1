import { processRasterFilter, type RasterFilterRequest } from './rasterFilters'
self.onmessage = (event: MessageEvent<RasterFilterRequest>) => {
  try {
    const pixels = processRasterFilter(event.data)
    self.postMessage({ pixels }, { transfer: [pixels.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка фильтра' })
  }
}
