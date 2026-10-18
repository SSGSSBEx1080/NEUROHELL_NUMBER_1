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
    const cleanup = () => {
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('Отменено', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) => {
      if (typeof data.progress === 'number') {
        progress(data.progress)
        return
      }
      cleanup()
      if (data.error) reject(new Error(data.error))
      else resolve(data.result)
    }
    worker.onerror = () => {
      cleanup()
      reject(new Error('Не удалось запустить восстановление'))
    }
    // Retain the preview input for retry/change settings; transfer fresh copies only.
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
  })
}
