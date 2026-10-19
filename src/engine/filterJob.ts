import type { RasterFilterRequest } from './rasterFilters'
export function runRasterFilter(
  request: RasterFilterRequest,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Отменено', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./filter.worker.ts', import.meta.url), { type: 'module' })
    let done = false
    const cleanup = () => {
      done = true
      clearTimeout(timer)
      worker.terminate()
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Отменено', 'AbortError'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Фильтр занял более 20 секунд. Уменьши слой или радиус.'))
    }, 20000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (done) return
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.pixels)
    }
    worker.onerror = () => {
      if (done) return
      cleanup()
      reject(new Error('Не удалось запустить фильтр.'))
    }
    try {
      const pixels = request.pixels.slice(),
        mask = request.mask?.slice()
      worker.postMessage({ ...request, pixels, mask }, [
        pixels.buffer,
        ...(mask ? [mask.buffer] : []),
      ])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
