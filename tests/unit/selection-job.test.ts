import { afterEach, describe, expect, it, vi } from 'vitest'
import { runSelection } from '../../src/engine/selectionJob'
import type { SelectionRequest } from '../../src/engine/selectionPixels'
class FakeWorker {
  static instances: FakeWorker[] = []
  static fail = false
  onmessage?: (event: { data: { coverage?: Uint8ClampedArray; error?: string } }) => void
  onerror?: () => void
  terminated = 0
  delivered?: SelectionRequest
  constructor() {
    FakeWorker.instances.push(this)
  }
  terminate() {
    this.terminated++
  }
  postMessage(request: SelectionRequest, transfer: Transferable[]) {
    if (FakeWorker.fail) throw new Error('Transfer failed')
    this.delivered = structuredClone(request, { transfer })
  }
}
const input = (): SelectionRequest => ({
  operation: 'modify',
  width: 4,
  height: 4,
  coverage: new Uint8ClampedArray(16),
  kind: 'expand',
  radius: 1,
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWorker.instances = []
  FakeWorker.fail = false
})
describe('selection workers', () => {
  it('cancels actual work, retains the original mask, ignores queued results', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController(),
      request = input(),
      job = runSelection(request, controller.signal),
      worker = FakeWorker.instances[0]
    expect(request.operation === 'modify' && request.coverage.byteLength).toBe(16)
    expect(worker.delivered?.operation).toBe('modify')
    controller.abort()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(1)
    worker.onmessage!({ data: { coverage: new Uint8ClampedArray(16) } })
    expect(worker.terminated).toBe(1)
  })
  it('does not start an aborted job and cleans up transfer failures', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const c = new AbortController()
    c.abort()
    await expect(runSelection(input(), c.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances).toHaveLength(0)
    FakeWorker.fail = true
    await expect(runSelection(input())).rejects.toThrow('Transfer failed')
    expect(FakeWorker.instances[0].terminated).toBe(1)
  })
  it('returns bounded results and terminates on its wall-clock deadline', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
    const result = new Uint8ClampedArray(16),
      job = runSelection(input())
    FakeWorker.instances[0].onmessage!({ data: { coverage: result } })
    expect(await job).toBe(result)
    expect(FakeWorker.instances[0].terminated).toBe(1)
    const timed = runSelection(input()),
      rejected = expect(timed).rejects.toThrow('20 секунд')
    await vi.advanceTimersByTimeAsync(20001)
    await rejected
    expect(FakeWorker.instances[1].terminated).toBe(1)
  })
})
