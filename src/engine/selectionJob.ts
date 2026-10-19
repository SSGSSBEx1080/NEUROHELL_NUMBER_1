import type { SelectionRequest } from './selectionPixels'
/** One cancellable worker. Copy before transfer: a cancelled preview never detaches a live selection. */
export function runSelection(
  request: SelectionRequest,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Отменено', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./selection.worker.ts', import.meta.url), { type: 'module' })
    let closed = false
    const cleanup = () => {
      closed = true
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
      reject(new Error('Выделение заняло более 20 секунд. Уменьши документ или радиус.'))
    }, 20000)
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (closed) return
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.coverage)
    }
    worker.onerror = () => {
      if (closed) return
      cleanup()
      reject(new Error('Не удалось запустить обработку выделения'))
    }
    try {
      if (request.operation === 'modify') {
        const coverage = request.coverage.slice()
        worker.postMessage({ ...request, coverage }, [coverage.buffer])
      } else {
        const pixels = request.pixels.slice()
        worker.postMessage({ ...request, pixels }, [pixels.buffer])
      }
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
