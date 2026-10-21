import type { DisplaceRequest, DisplaceResult } from './displace'

export function runDisplace(
  request: DisplaceRequest,
  signal?: AbortSignal,
): Promise<DisplaceResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Отменено', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./displace.worker.ts', import.meta.url), { type: 'module' })
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
      reject(new Error('Смещение по карте заняло более 20 секунд. Уменьши слой или карту.'))
    }, 20000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (done) return
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data as DisplaceResult)
    }
    worker.onerror = () => {
      if (done) return
      cleanup()
      reject(new Error('Не удалось запустить смещение по карте.'))
    }
    try {
      const pixels = request.pixels.slice(),
        mapPixels = request.mapPixels.slice(),
        mask = request.mask?.slice(),
        transfers: Transferable[] = [pixels.buffer, mapPixels.buffer]
      if (mask) transfers.push(mask.buffer)
      worker.postMessage({ ...request, pixels, mapPixels, mask }, transfers)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
