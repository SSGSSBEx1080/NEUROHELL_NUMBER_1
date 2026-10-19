/** PSD section boundaries. Used to retain the exact original merged pixels for metadata-only edits. */
export function mergedOffset(buffer: ArrayBuffer): number {
  const v = new DataView(buffer)
  let p = 26
  const take = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || p + n > buffer.byteLength)
      throw new Error('Повреждённые секции PSD')
    p += n
  }
  const length = (large = false) => {
    if (p + (large ? 8 : 4) > buffer.byteLength) throw new Error('Обрезанный PSD')
    const n = large ? Number(v.getBigUint64(p)) : v.getUint32(p)
    take(large ? 8 : 4)
    return n
  }
  take(length())
  take(length())
  take(length(v.getUint16(4) === 2))
  return p
}
export function preserveMergedPixels(original: ArrayBuffer, output: ArrayBuffer): ArrayBuffer {
  const a = new DataView(original),
    b = new DataView(output)
  // RLE row-length tables differ between PSD and PSB; gray/RGB channel layouts also differ.
  if (
    [4, 22, 24].some((offset) => a.getUint16(offset) !== b.getUint16(offset)) ||
    a.getUint32(14) !== b.getUint32(14) ||
    a.getUint32(18) !== b.getUint32(18)
  )
    return output
  const from = mergedOffset(original),
    to = mergedOffset(output),
    result = new Uint8Array(to + original.byteLength - from)
  result.set(new Uint8Array(output, 0, to))
  result.set(new Uint8Array(original, from), to)
  new DataView(result.buffer).setUint16(12, a.getUint16(12))
  return result.buffer
}
/** Preserve unknown image resources (including ICC) on appearance-preserving edits.
 * ag-psd cannot serialize resources it does not decode. Never copy these blindly
 * after visual changes: some are color/geometry dependent. */
function resources(buffer: ArrayBuffer) {
  const v = new DataView(buffer),
    lengthAt = 30 + v.getUint32(26)
  if (lengthAt + 4 > buffer.byteLength) throw new Error('Обрезанные ресурсы PSD')
  const start = lengthAt + 4,
    end = start + v.getUint32(lengthAt),
    blocks: { id: number; start: number; end: number; dataStart: number; length: number }[] = []
  if (end > buffer.byteLength) throw new Error('Ресурсы PSD выходят за границы файла')
  for (let p = start; p < end;) {
    if (p + 8 > end) throw new Error('Обрезанный блок ресурсов PSD')
    const nameSize = 1 + v.getUint8(p + 6),
      sizeAt = p + 6 + nameSize + (nameSize % 2)
    if (sizeAt + 4 > end) throw new Error('Обрезанное имя ресурса PSD')
    const length = v.getUint32(sizeAt),
      next = sizeAt + 4 + length + (length % 2)
    if (next > end) throw new Error('Обрезанные данные ресурса PSD')
    blocks.push({ id: v.getUint16(p + 4), start: p, end: next, dataStart: sizeAt + 4, length })
    p = next
  }
  return { lengthAt, start, end, blocks }
}
export function preserveUnknownResources(original: ArrayBuffer, output: ArrayBuffer): ArrayBuffer {
  const from = resources(original),
    to = resources(output),
    known = new Set(to.blocks.map((b) => b.id))
  const sameColorMode = new DataView(original).getUint16(24) === new DataView(output).getUint16(24)
  const missing = from.blocks.filter((b) => !known.has(b.id) && (b.id !== 1039 || sameColorMode))
  const extra = missing.reduce((size, b) => size + b.end - b.start, 0)
  if (!extra) return output
  const bytes = new Uint8Array(output.byteLength + extra)
  bytes.set(new Uint8Array(output, 0, to.end))
  let p = to.end
  for (const block of missing) {
    bytes.set(new Uint8Array(original, block.start, block.end - block.start), p)
    p += block.end - block.start
  }
  bytes.set(new Uint8Array(output, to.end), p)
  new DataView(bytes.buffer).setUint32(to.lengthAt, to.end - to.start + extra)
  return bytes.buffer
}

export function xmpResource(buffer: ArrayBuffer) {
  const block = resources(buffer).blocks.find((b) => b.id === 1060)
  return block ? { start: block.dataStart, length: block.length } : undefined
}
