import type { SelectionRaster } from '../types'
const cache = new WeakMap<SelectionRaster, { path: string; simplified: boolean }>()
/** Merge collinear pixel boundary runs. Huge/noisy masks get a bounded display contour only;
 * full-resolution coverage is never simplified for painting, masks, PSD or exports. */
export function rasterOutline(r: SelectionRaster) {
  const found = cache.get(r)
  if (found) return found
  let step = Math.max(1, Math.ceil(Math.max(r.width, r.height) / 1024))
  for (;;) {
    const w = Math.ceil(r.width / step),
      h = Math.ceil(r.height / step),
      parts: string[] = []
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= w || y >= h
        ? false
        : r.data[
            Math.min(r.height - 1, Math.floor((y + 0.5) * step)) * r.width +
              Math.min(r.width - 1, Math.floor((x + 0.5) * step))
          ] >= 128
    for (let y = 0; y <= h && parts.length <= 12000; y++) {
      let start = -1
      for (let x = 0; x <= w; x++) {
        const edge = x < w && at(x, y - 1) !== at(x, y)
        if (edge && start < 0) start = x
        if (!edge && start >= 0) {
          parts.push(
            `M${r.x + start * step},${r.y + Math.min(r.height, y * step)}H${r.x + Math.min(r.width, x * step)}`,
          )
          start = -1
        }
      }
    }
    for (let x = 0; x <= w && parts.length <= 12000; x++) {
      let start = -1
      for (let y = 0; y <= h; y++) {
        const edge = y < h && at(x - 1, y) !== at(x, y)
        if (edge && start < 0) start = y
        if (!edge && start >= 0) {
          parts.push(
            `M${r.x + Math.min(r.width, x * step)},${r.y + start * step}V${r.y + Math.min(r.height, y * step)}`,
          )
          start = -1
        }
      }
    }
    if (parts.length <= 12000 || step >= Math.max(r.width, r.height)) {
      const result = { path: parts.join(''), simplified: step > 1 }
      cache.set(r, result)
      return result
    }
    step *= 2
  }
}
