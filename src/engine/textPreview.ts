import type { PixelData } from 'ag-psd'
/** Transparent Canvas readback can quantize a solid glyph's unpremultiplied RGB
 * (for example paint 21 becomes 20 at alpha 224). A native Type cache should use
 * the actual paint. Only accept a wholly monochrome cache within its quantization
 * bound; coloured glyphs/emoji must retain their real pixel colours. */
export function canonicalTextPreview(image: PixelData, color: string): void {
  if (!/^#[a-f0-9]{6}$/i.test(color)) return
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)),
    data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (!alpha) continue
    const tolerance = Math.ceil(255 / alpha)
    if ([0, 1, 2].some((c) => Math.abs(data[i + c] - rgb[c]) > tolerance)) return
  }
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3]) for (let c = 0; c < 3; c++) data[i + c] = rgb[c]
}
