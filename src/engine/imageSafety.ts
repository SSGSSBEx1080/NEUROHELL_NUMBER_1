/** Inspect image headers before decoding; protects against tiny compressed files with giant rasters. */
export function rasterDimensions(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(12) === 0x49484452) return { width: v.getUint32(16), height: v.getUint32(20) }
  if (bytes.length >= 30 && v.getUint32(0) === 0x52494646 && v.getUint32(8) === 0x57454250) {
    const kind = v.getUint32(12)
    if (kind === 0x56503858) return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) }
    if (kind === 0x56503820) return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff }
    if (kind === 0x5650384c) { const bits = v.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 } }
  }
  if (bytes.length > 4 && v.getUint16(0) === 0xffd8) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) break
      const length = v.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) return { height: v.getUint16(offset + 3), width: v.getUint16(offset + 5) }
      offset += length
    }
  }
  throw new Error('Не удалось прочитать заголовок изображения. Пересохрани файл в PNG, JPEG или WebP.')
}
export function sourceDimensions(src: string) {
  if (src === '/demo-landscape.webp') return { width: 1312, height: 816 }
  const comma = src.indexOf(',')
  if (comma < 0 || !/^data:image\/(png|jpeg|webp);base64,/i.test(src)) throw new Error('Разрешены только локальные растровые изображения')
  const prefix = src.slice(comma + 1, comma + 1 + 699052)
  const binary = atob(prefix), bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  const size = rasterDimensions(bytes)
  if (!size.width || !size.height || size.width > 16384 || size.height > 16384 || size.width * size.height > 32_000_000) throw new Error('Исходное изображение слишком велико: максимум 32 мегапикселя. Уменьши файл перед импортом.')
  return size
}
