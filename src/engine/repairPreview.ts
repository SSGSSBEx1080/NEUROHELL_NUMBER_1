import type { RepairResult } from './repair'
interface Source {
  width: number
  height: number
  pixels: Uint8ClampedArray
  mask: Uint8Array
  donors: Uint8Array
}
const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
const target = [196, 153, 255],
  allowed = [55, 199, 149],
  blocked = [255, 95, 105]
/** GPU compositing for the slider; only the dirty donor-brush rectangle is recolored on a drag.
 * Full RGBA copies happen once per worker result, never on every pointer event. */
export class RepairPreview {
  private original: HTMLCanvasElement
  private after: HTMLCanvasElement
  private overlay: HTMLCanvasElement
  private result: RepairResult | null = null
  private dirty: { x: number; y: number; right: number; bottom: number } | null
  constructor(readonly source: Source) {
    this.original = canvas(source.width, source.height)
    this.after = canvas(source.width, source.height)
    this.overlay = canvas(source.width, source.height)
    this.original
      .getContext('2d')!
      .putImageData(new ImageData(source.pixels.slice(), source.width, source.height), 0, 0)
    this.dirty = { x: 0, y: 0, right: source.width, bottom: source.height }
  }
  invalidate(x = 0, y = 0, width = this.source.width, height = this.source.height) {
    const left = Math.max(0, Math.floor(x)),
      top = Math.max(0, Math.floor(y)),
      right = Math.min(this.source.width, Math.ceil(x + width)),
      bottom = Math.min(this.source.height, Math.ceil(y + height))
    if (right <= left || bottom <= top) return
    const d = this.dirty
    this.dirty = d
      ? {
          x: Math.min(d.x, left),
          y: Math.min(d.y, top),
          right: Math.max(d.right, right),
          bottom: Math.max(d.bottom, bottom),
        }
      : { x: left, y: top, right, bottom }
  }
  draw(output: HTMLCanvasElement, result: RepairResult | null, split: number, protect: boolean) {
    const s = this.source
    if (output.width !== s.width || output.height !== s.height) {
      output.width = s.width
      output.height = s.height
    }
    if (result !== this.result) {
      if (result) {
        const patch = canvas(s.width, s.height),
          pixels = result.pixels.slice()
        for (let p = 0; p < result.mask.length; p++) pixels[p * 4 + 3] = result.mask[p]
        patch.getContext('2d')!.putImageData(new ImageData(pixels, s.width, s.height), 0, 0)
        const a = this.after.getContext('2d')!
        a.clearRect(0, 0, s.width, s.height)
        a.drawImage(this.original, 0, 0)
        a.drawImage(patch, 0, 0)
        patch.width = patch.height = 1
      }
      this.result = result
    }
    const ctx = output.getContext('2d')!
    ctx.clearRect(0, 0, s.width, s.height)
    ctx.drawImage(this.original, 0, 0)
    if (protect) {
      const d = this.dirty
      if (d) {
        const w = d.right - d.x,
          h = d.bottom - d.y,
          patch = new Uint8ClampedArray(w * h * 4)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const p = (d.y + y) * s.width + d.x + x,
              i = (y * w + x) * 4,
              tint = s.mask[p]
                ? target
                : s.donors[p] && s.pixels[p * 4 + 3] >= 250
                  ? allowed
                  : blocked
            patch[i] = tint[0]
            patch[i + 1] = tint[1]
            patch[i + 2] = tint[2]
            patch[i + 3] = s.pixels[p * 4 + 3] ? 77 : 0
          }
        this.overlay.getContext('2d')!.putImageData(new ImageData(patch, w, h), d.x, d.y)
        this.dirty = null
      }
      ctx.drawImage(this.overlay, 0, 0)
    } else {
      const x = Math.round((s.width * split) / 100)
      if (result) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, 0, s.width - x, s.height)
        ctx.clip()
        ctx.drawImage(this.after, 0, 0)
        ctx.restore()
      }
      ctx.fillStyle = '#b7a2ff'
      ctx.fillRect(x, 0, Math.max(1, s.width / 500), s.height)
    }
  }
  dispose() {
    for (const c of [this.original, this.after, this.overlay]) c.width = c.height = 1
    this.result = null
  }
}
