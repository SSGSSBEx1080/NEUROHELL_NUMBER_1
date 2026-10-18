import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRepair } from '../../src/engine/repairJob'
import type { RepairRequest, RepairResult } from '../../src/engine/repair'
class FakeWorker {
  static instances: FakeWorker[] = []
  static fail = false
  onmessage?: (event: {
    data: { progress?: number; result?: RepairResult; error?: string }
  }) => void
  onerror?: () => void
  terminated = 0
  delivered?: RepairRequest
  constructor() {
    FakeWorker.instances.push(this)
  }
  terminate() {
    this.terminated++
  }
  postMessage(data: RepairRequest, transfer: Transferable[]) {
    if (FakeWorker.fail) throw new Error('Transfer failed')
    this.delivered = structuredClone(data, { transfer })
  }
}
const request = (): RepairRequest => ({
  width: 3,
  height: 3,
  pixels: new Uint8ClampedArray(36).fill(255),
  mask: new Uint8Array(9),
  donors: new Uint8Array(9).fill(255),
  mode: 'auto',
  radius: 2,
  search: 12,
  expand: 0,
  feather: 0,
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWorker.instances = []
  FakeWorker.fail = false
})
describe('Repair worker lifecycle', () => {
  it('terminates work on abort, retains preview input and ignores queued progress', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const controller = new AbortController(),
      input = request(),
      progress = vi.fn(),
      job = runRepair(input, controller.signal, progress),
      worker = FakeWorker.instances[0]
    expect(worker.delivered!.pixels.length).toBe(36)
    expect(input.pixels.byteLength).toBe(36)
    expect(input.donors!.byteLength).toBe(9)
    worker.onmessage!({ data: { progress: 0.3 } })
    expect(progress).toHaveBeenCalledWith(0.3)
    controller.abort()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(1)
    worker.onmessage!({ data: { progress: 0.5 } })
    expect(progress).toHaveBeenCalledTimes(1)
  })
  it('does not allocate an already cancelled worker and cleans up a failed transfer', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const c = new AbortController()
    c.abort()
    await expect(runRepair(request(), c.signal, () => {})).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(FakeWorker.instances).toHaveLength(0)
    FakeWorker.fail = true
    await expect(runRepair(request(), new AbortController().signal, () => {})).rejects.toThrow(
      'Transfer failed',
    )
    expect(FakeWorker.instances[0].terminated).toBe(1)
  })
  it('cleans up successful results and applies a finite wall-clock deadline', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
    const output: RepairResult = {
      pixels: new Uint8ClampedArray(36),
      mask: new Uint8Array(9),
      mode: 'smooth',
      filled: 1,
      patches: 0,
      comparisons: 0,
    }
    const job = runRepair(request(), new AbortController().signal, () => {})
    FakeWorker.instances[0].onmessage!({ data: { result: output } })
    expect(await job).toBe(output)
    expect(FakeWorker.instances[0].terminated).toBe(1)
    const pending = runRepair(request(), new AbortController().signal, () => {}),
      rejected = expect(pending).rejects.toThrow(/минуты/)
    await vi.advanceTimersByTimeAsync(60001)
    await rejected
    expect(FakeWorker.instances[1].terminated).toBe(1)
  })
})
