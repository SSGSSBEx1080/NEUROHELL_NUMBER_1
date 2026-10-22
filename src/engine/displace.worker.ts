import { processDisplace, type DisplaceRequest } from './displace'

self.onmessage = (event: MessageEvent<DisplaceRequest>) => {
  try {
    const result = processDisplace(event.data)
    self.postMessage(result, { transfer: [result.pixels.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка смещения по карте' })
  }
}
