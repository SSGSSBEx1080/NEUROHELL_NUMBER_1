import type { RepairRequest, RepairResult } from './repair'
/** One isolated worker per cancellable job. Stopping it stops CPU work, not only the spinner. */
export function runRepair(
  request: RepairRequest,
  signal: AbortSignal,
  progress: (n: number) => void,
): Promise<RepairResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Отменено', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./repair.worker.ts', import.meta.url), { type: 'module' })
    let closed = false
    const cleanup = () => {
      closed = true
      clearTimeout(timer)
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Отменено', 'AbortError'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error('Восстановление заняло больше минуты. Уменьши область или выбери гладкий фон.'),
      )
    }, 60000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (closed) return
      if (typeof data.progress === 'number') {
        progress(data.progress)
        return
      }
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.result)
    }
    worker.onerror = () => {
      if (!closed) {
        cleanup()
        reject(new Error('Не удалось запустить восстановление'))
      }
    }
    try {
      // Retain immutable preview input for retry/change settings; transfer fresh copies only.
      const copy = {
        ...request,
        pixels: request.pixels.slice(),
        mask: request.mask.slice(),
        donors: request.donors?.slice(),
      }
      worker.postMessage(copy, [
        copy.pixels.buffer,
        copy.mask.buffer,
        ...(copy.donors ? [copy.donors.buffer] : []),
      ])
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
