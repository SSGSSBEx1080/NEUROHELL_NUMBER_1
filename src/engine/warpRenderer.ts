import type { Layer, Quad } from '../types'
import { homography, project } from './projection'
import { rasterBounds } from './layerGeometry'
import { projectTexture } from './projectiveTexture'
const cache = new Map<
  string,
  {
    layer: Layer
    positioned: boolean
    image: HTMLCanvasElement
    left: number
    top: number
    width: number
    height: number
  }
>()
const ignore = new Set(['x', 'y', 'rotation', 'opacity', 'blendMode', 'name', 'visible', 'locked'])
const same = (a: Layer, b: Layer, positioned: boolean) =>
  (!positioned ||
    (a.rotation === b.rotation && Number.isInteger(a.x - b.x) && Number.isInteger(a.y - b.y))) &&
  Object.keys(a).length === Object.keys(b).length &&
  (Object.keys(a) as (keyof Layer)[]).every((k) => ignore.has(k) || a[k] === b[k])
export function clearWarpCache() {
  cache.clear()
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}
/** Project the editable source once. Overlapping Canvas triangle clips accumulate
 * intrinsic alpha (e.g. 50% becomes 75%), so use a texture projection, not a paint mesh.
 * Positioned output is aligned to DOCUMENT pixels, regardless of the layer's local
 * origin: an equivalent native smart-object placement must not change sampling phase.
 */
export function renderWarped(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  drawBase: (ctx: CanvasRenderingContext2D) => void,
  volatile = false,
  positioned = false,
) {
  let entry = cache.get(layer.id)
  if (
    volatile ||
    !entry ||
    entry.positioned !== positioned ||
    !same(entry.layer, layer, positioned)
  ) {
    const matrix = homography(layer.warp!),
      bounds = rasterBounds(layer, true, true)
    const sourceW = bounds.width,
      sourceH = bounds.height,
      sourceScale = Math.min(1, 4096 / sourceW, 4096 / sourceH)
    const source = canvas(sourceW * sourceScale, sourceH * sourceScale),
      s = source.getContext('2d')!
    s.scale(source.width / sourceW, source.height / sourceH)
    s.translate(-bounds.x, -bounds.y)
    drawBase(s)
    const angle = (layer.rotation * Math.PI) / 180,
      cosine = Math.cos(angle),
      sine = Math.sin(angle)
    const mapped = (u: number, v: number) => {
      const p = project(
        matrix,
        (u * sourceW + bounds.x) / layer.width,
        (v * sourceH + bounds.y) / layer.height,
      )
      const x = p.x * layer.width,
        y = p.y * layer.height
      return {
        x: Math.max(
          -32768,
          Math.min(
            32768,
            positioned
              ? layer.x +
                  layer.width / 2 +
                  (x - layer.width / 2) * cosine -
                  (y - layer.height / 2) * sine
              : x,
          ),
        ),
        y: Math.max(
          -32768,
          Math.min(
            32768,
            positioned
              ? layer.y +
                  layer.height / 2 +
                  (x - layer.width / 2) * sine +
                  (y - layer.height / 2) * cosine
              : y,
          ),
        ),
      }
    }
    const corners = [mapped(0, 0), mapped(1, 0), mapped(1, 1), mapped(0, 1)]
    const left = Math.floor(Math.min(...corners.map((p) => p.x))) - 1,
      top = Math.floor(Math.min(...corners.map((p) => p.y))) - 1
    const width = Math.ceil(Math.max(...corners.map((p) => p.x)) - left) + 1,
      height = Math.ceil(Math.max(...corners.map((p) => p.y)) - top) + 1,
      quality = Math.min(1, 4096 / width, 4096 / height),
      output = canvas(width * quality, height * quality)
    const quad = corners.map((p) => ({
      x: ((p.x - left) * output.width) / width,
      y: ((p.y - top) * output.height) / height,
    })) as Quad
    projectTexture(source, output, quad)
    entry = { layer, positioned, image: output, left, top, width, height }
    cache.set(layer.id, entry)
    let bytes = [...cache.values()].reduce((sum, v) => sum + v.image.width * v.image.height * 4, 0)
    for (const [key, value] of cache) {
      if (bytes <= 64 * 1024 * 1024 && cache.size <= 8) break
      if (key !== layer.id) {
        bytes -= value.image.width * value.image.height * 4
        cache.delete(key)
      }
    }
  }
  const dx = positioned ? layer.x - entry.layer.x : 0,
    dy = positioned ? layer.y - entry.layer.y : 0
  ctx.drawImage(entry.image, entry.left + dx, entry.top + dy, entry.width, entry.height)
}
