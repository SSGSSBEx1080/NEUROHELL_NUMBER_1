import { processSelection, type SelectionRequest } from './selectionPixels'
self.onmessage = (event: MessageEvent<SelectionRequest>) => {
  try {
    const coverage = processSelection(event.data)
    self.postMessage({ coverage }, { transfer: [coverage.buffer] })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка выделения' })
  }
}
