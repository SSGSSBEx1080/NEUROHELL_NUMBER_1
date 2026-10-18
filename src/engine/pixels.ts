export interface PixelRequest {
  operation: 'background' | 'wand' | 'erase' | 'fill'
  width: number
  height: number
  pixels: Uint8ClampedArray
  tolerance?: number
  x?: number
  y?: number
  rect?: { x: number; y: number; width: number; height: number }
}
const distance = (a: Uint8ClampedArray, i: number, color: number[]) => {
  const r = a[i] - color[0], g = a[i + 1] - color[1], b = a[i + 2] - color[2]
  return r * r * 0.3 + g * g * 0.59 + b * b * 0.11
}

/** Connected color segmentation, not semantic/AI segmentation. Runs in a Web Worker. */
export function processPixels({ operation, width: w, height: h, pixels, tolerance = 20, x = 0, y = 0, rect }: PixelRequest): Uint8ClampedArray {
  if (w < 1 || h < 1 || pixels.length !== w * h * 4) throw new Error('Некорректные пиксели')
  const result = new Uint8ClampedArray(pixels)
  if ((operation === 'erase' || operation === 'fill') && rect) {
    const left = Math.max(0, Math.floor(rect.x)), top = Math.max(0, Math.floor(rect.y))
    const right = Math.min(w, Math.ceil(rect.x + rect.width)), bottom = Math.min(h, Math.ceil(rect.y + rect.height))
    if (operation === 'erase') {
      for (let yy = top; yy < bottom; yy++) for (let xx = left; xx < right; xx++) result[(yy * w + xx) * 4 + 3] = 0
      return result
    }
    // Boundary diffusion: useful for small distractions on smooth backgrounds, not generative inpainting.
    const missing = new Uint8Array(w * h)
    const queued = new Uint8Array(w * h)
    const queue = new Uint32Array(w * h)
    let head = 0, tail = 0
    for (let yy = top; yy < bottom; yy++) for (let xx = left; xx < right; xx++) missing[yy * w + xx] = 1
    const neighbors = (p: number) => {
      const xx = p % w, yy = Math.floor(p / w)
      const n: number[] = []
      if (xx > 0) n.push(p - 1)
      if (xx < w - 1) n.push(p + 1)
      if (yy > 0) n.push(p - w)
      if (yy < h - 1) n.push(p + w)
      return n
    }
    for (let yy = top; yy < bottom; yy++) for (let xx = left; xx < right; xx++) {
      if (xx !== left && xx !== right - 1 && yy !== top && yy !== bottom - 1) continue
      const p = yy * w + xx
      if (neighbors(p).some(n => !missing[n])) { queue[tail++] = p; queued[p] = 1 }
    }
    if (!tail) throw new Error('Для заливки оставьте часть изображения за пределами выделения')
    while (head < tail) {
      const p = queue[head++]
      const ns = neighbors(p)
      const available = ns.filter(n => !missing[n])
      if (!available.length) continue
      for (let c = 0; c < 4; c++) result[p * 4 + c] = Math.round(available.reduce((sum, n) => sum + result[n * 4 + c], 0) / available.length)
      missing[p] = 0
      for (const n of ns) if (missing[n] && !queued[n]) { queued[n] = 1; queue[tail++] = n }
    }
    return result
  }
  const threshold = Math.max(0.01, Math.min(100, tolerance) * 2.55) ** 2
  const palette: number[][] = []
  if (operation === 'wand') {
    x = Math.min(w - 1, Math.max(0, Math.round(x))); y = Math.min(h - 1, Math.max(0, Math.round(y)))
    const i = (y * w + x) * 4
    palette.push([pixels[i], pixels[i + 1], pixels[i + 2]])
  } else {
    const sample = Math.max(1, Math.min(12, Math.floor(Math.min(w, h) / 30)))
    for (const [cx, cy] of [[0, 0], [w - sample, 0], [0, h - sample], [w - sample, h - sample]]) {
      const color = [0, 0, 0]; let count = 0
      for (let yy = cy; yy < cy + sample; yy++) for (let xx = cx; xx < cx + sample; xx++) {
        const i = (yy * w + xx) * 4
        if (pixels[i + 3] < 10) continue
        for (let c = 0; c < 3; c++) color[c] += pixels[i + c]
        count++
      }
      if (count) palette.push(color.map(c => c / count))
    }
    // Transparent corners should not cause an opaque object elsewhere to disappear.
    if (!palette.length) return result
  }
  const visited = new Uint8Array(w * h)
  const queue = new Uint32Array(w * h)
  let head = 0, tail = 0
  const enqueue = (p: number) => {
    if (visited[p]) return
    visited[p] = 1
    if (pixels[p * 4 + 3] === 0 || palette.some(color => distance(pixels, p * 4, color) <= threshold)) queue[tail++] = p
  }
  if (operation === 'wand') enqueue(y * w + x)
  else {
    for (let xx = 0; xx < w; xx++) { enqueue(xx); enqueue((h - 1) * w + xx) }
    for (let yy = 1; yy < h - 1; yy++) { enqueue(yy * w); enqueue(yy * w + w - 1) }
  }
  while (head < tail) {
    const p = queue[head++]
    result[p * 4 + 3] = 0
    const xx = p % w, yy = Math.floor(p / w)
    if (xx > 0) enqueue(p - 1)
    if (xx < w - 1) enqueue(p + 1)
    if (yy > 0) enqueue(p - w)
    if (yy < h - 1) enqueue(p + w)
  }
  return result
}
