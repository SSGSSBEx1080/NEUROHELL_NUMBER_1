import { repairPixels, type RepairRequest } from './repair'
self.onmessage = (event: MessageEvent<RepairRequest>) => {
  try {
    const result = repairPixels(event.data, (progress) => self.postMessage({ progress }))
    self.postMessage({ result }, { transfer: [result.pixels.buffer, result.mask.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка восстановления' })
  }
}
