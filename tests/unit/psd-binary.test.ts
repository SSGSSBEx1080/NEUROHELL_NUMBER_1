import { expect, it } from 'vitest'
import { mergedOffset, preserveUnknownResources } from '../../src/engine/psdBinary'
function resource(id: number, data: number[]) {
  const b = new Uint8Array(12 + data.length + (data.length % 2)),
    v = new DataView(b.buffer)
  v.setUint32(0, 0x3842494d)
  v.setUint16(4, id)
  v.setUint32(8, data.length)
  b.set(data, 12)
  return b
}
function psd(blocks: Uint8Array[]) {
  const size = blocks.reduce((n, b) => n + b.byteLength, 0),
    bytes = new Uint8Array(43 + size),
    v = new DataView(bytes.buffer)
  v.setUint32(0, 0x38425053)
  v.setUint16(4, 1)
  v.setUint16(12, 3)
  v.setUint32(14, 1)
  v.setUint32(18, 1)
  v.setUint16(22, 8)
  v.setUint16(24, 3)
  v.setUint32(30, size)
  let p = 34
  for (const block of blocks) {
    bytes.set(block, p)
    p += block.length
  }
  bytes.set([11, 22, 33], p + 6)
  return bytes.buffer
}
it('retains unknown resources and ICC without replacing rewritten metadata or merged bytes', () => {
  const original = psd([resource(1039, [1, 2, 3]), resource(1060, [4, 5])]),
    output = psd([resource(1060, [6, 7])])
  const patched = preserveUnknownResources(original, output)
  expect(new Uint8Array(patched)).toEqual(
    new Uint8Array(psd([resource(1060, [6, 7]), resource(1039, [1, 2, 3])])),
  )
  expect(new Uint8Array(patched, mergedOffset(patched))).toEqual(
    new Uint8Array(output, mergedOffset(output)),
  )
  expect(preserveUnknownResources(original, patched)).toBe(patched)
})
it('rejects malformed lengths and does not carry a grayscale ICC into RGB', () => {
  const original = psd([resource(1039, [1, 2, 3])]),
    output = psd([])
  new DataView(original).setUint16(24, 1)
  expect(preserveUnknownResources(original, output)).toBe(output)
  new DataView(original).setUint32(30, 0x7fffffff)
  expect(() => preserveUnknownResources(original, output)).toThrow()
})
