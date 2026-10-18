/** PSD section boundaries. Used to retain the exact original merged pixels for metadata-only edits. */
export function mergedOffset(buffer: ArrayBuffer): number {
  const v = new DataView(buffer); let p = 26
  const take = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || p + n > buffer.byteLength) throw new Error('Повреждённые секции PSD'); p += n }
  const length = (large = false) => { if (p + (large ? 8 : 4) > buffer.byteLength) throw new Error('Обрезанный PSD'); const n = large ? Number(v.getBigUint64(p)) : v.getUint32(p); take(large ? 8 : 4); return n }
  take(length()); take(length()); take(length(v.getUint16(4) === 2))
  return p
}
export function preserveMergedPixels(original: ArrayBuffer, output: ArrayBuffer): ArrayBuffer {
  const a = new DataView(original), b = new DataView(output)
  // RLE row-length tables differ between PSD and PSB; gray/RGB channel layouts also differ.
  if ([4, 22, 24].some(offset => a.getUint16(offset) !== b.getUint16(offset)) || a.getUint32(14) !== b.getUint32(14) || a.getUint32(18) !== b.getUint32(18)) return output
  const from = mergedOffset(original), to = mergedOffset(output), result = new Uint8Array(to + original.byteLength - from)
  result.set(new Uint8Array(output, 0, to)); result.set(new Uint8Array(original, from), to)
  new DataView(result.buffer).setUint16(12, a.getUint16(12))
  return result.buffer
}
