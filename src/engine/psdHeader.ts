/** Fail before allocating any decoded pixels. PSB container support is not an unlimited canvas. */
export function validatePsdHeader(buffer: ArrayBuffer) {
  if (buffer.byteLength < 26) throw new Error('Файл PSD/PSB обрезан или повреждён')
  if (buffer.byteLength > 80 * 1024 * 1024) throw new Error('PSD/PSB: файл до 80 МБ')
  const v = new DataView(buffer)
  if (v.getUint32(0) !== 0x38425053 || ![1, 2].includes(v.getUint16(4))) throw new Error('Это не корректный PSD/PSB')
  const height = v.getUint32(14), width = v.getUint32(18), depth = v.getUint16(22), mode = v.getUint16(24)
  if (!width || !height || width > 4096 || height > 4096) throw new Error('В этой версии PSD/PSB поддерживается до 4096 × 4096 px. Уменьши документ перед импортом.')
  if (depth !== 8) throw new Error('Поддерживается PSD/PSB с глубиной 8 бит/канал. Сначала преобразуй документ в RGB / 8 бит.')
  if (mode !== 3 && mode !== 1) throw new Error('Поддерживаются RGB и оттенки серого. CMYK, Lab и индексированные цвета нужно предварительно преобразовать в RGB.')
  return { width, height, psb: v.getUint16(4) === 2, depth, mode }
}
