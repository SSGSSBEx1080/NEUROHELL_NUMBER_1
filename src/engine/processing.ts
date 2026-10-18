import type { PixelRequest } from './pixels'
let worker: Worker | undefined
let nextId = 0
const pending = new Map<
  number,
  { resolve: (pixels: Uint8ClampedArray) => void; reject: (error: Error) => void }
>()
export function runPixelOperation(request: PixelRequest): Promise<Uint8ClampedArray> {
  if (!worker) {
    worker = new Worker(new URL('./pixel.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id)
      if (!job) return
      pending.delete(data.id)
      if (data.error) job.reject(new Error(data.error))
      else job.resolve(data.pixels)
    }
    worker.onerror = () => {
      for (const job of pending.values())
        job.reject(new Error('Обработка недоступна в этом браузере'))
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    worker!.postMessage({ ...request, id }, [
      request.pixels.buffer,
      ...(request.mask ? [request.mask.buffer] : []),
    ])
  })
}
