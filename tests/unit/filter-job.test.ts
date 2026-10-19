import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRasterFilter } from '../../src/engine/filterJob'
import { defaultRasterFilter, type RasterFilterRequest } from '../../src/engine/rasterFilters'
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage?: (event: { data: { pixels?: Uint8ClampedArray; error?: string } }) => void
  onerror?: () => void
  terminated = 0
  delivered?: RasterFilterRequest
  constructor() {
    FakeWorker.instances.push(this)
  }
  terminate() {
    this.terminated++
  }
  postMessage(value: RasterFilterRequest, transfer: Transferable[]) {
    this.delivered = structuredClone(value, { transfer })
  }
}
const request = (): RasterFilterRequest => ({
  width: 2,
  height: 2,
  pixels: new Uint8ClampedArray(16),
  mask: new Uint8ClampedArray(4),
  filter: defaultRasterFilter('median'),
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeWorker.instances = []
})
describe('filter worker lifecycle', () => {
  it('cancel stops processing but never detaches pixels or the original selection', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const c = new AbortController(),
      input = request(),
      p = runRasterFilter(input, c.signal),
      w = FakeWorker.instances[0]
    expect(input.pixels.byteLength).toBe(16)
    expect(input.mask?.byteLength).toBe(4)
    expect(w.delivered?.pixels.byteLength).toBe(16)
    c.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(w.terminated).toBe(1)
    w.onmessage!({ data: { pixels: new Uint8ClampedArray(16) } })
    expect(w.terminated).toBe(1)
  })
  it('cleans up success, errors and deadlines', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.useFakeTimers()
    const p = runRasterFilter(request()),
      pixels = new Uint8ClampedArray(16)
    FakeWorker.instances[0].onmessage!({ data: { pixels } })
    expect(await p).toBe(pixels)
    const failed = runRasterFilter(request())
    FakeWorker.instances[1].onerror!()
    await expect(failed).rejects.toThrow('запустить')
    const slow = runRasterFilter(request()),
      check = expect(slow).rejects.toThrow('20 секунд')
    await vi.advanceTimersByTimeAsync(20001)
    await check
    expect(FakeWorker.instances.every((w) => w.terminated === 1)).toBe(true)
  })
})
