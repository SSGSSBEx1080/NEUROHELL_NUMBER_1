import type { Point, ToolSettings } from '../types'
import { applyRetouchDab, type RetouchTool } from './retouch'
/** Small reusable stamps avoid full-size intermediate surfaces on every pointermove. */
export function brushStamp(size: number, color: string, hardness: number) {
  size = Math.max(1, Math.min(2048, size))
  hardness = Math.max(0, Math.min(100, hardness))
  const c = document.createElement('canvas')
  c.width = c.height = Math.max(1, Math.ceil(size))
  const x = c.getContext('2d')!,
    r = size / 2
  if (hardness >= 99) {
    x.fillStyle = color
    x.beginPath()
    x.arc(r, r, r, 0, Math.PI * 2)
    x.fill()
  } else {
    const g = x.createRadialGradient(r, r, Math.max(0, (r * hardness) / 100), r, r, r)
    g.addColorStop(0, color)
    g.addColorStop(1, color + '00')
    x.fillStyle = g
    x.fillRect(0, 0, c.width, c.height)
  }
  return c
}
/** Tint a sampled alpha tip with the foreground colour at the requested diameter. */
export function sampledBrushStamp(
  image: HTMLImageElement | HTMLCanvasElement,
  size: number,
  color: string,
) {
  const sourceW = (image as HTMLImageElement).naturalWidth || image.width,
    sourceH = (image as HTMLImageElement).naturalHeight || image.height,
    scale = Math.max(1, Math.min(2048, size)) / Math.max(1, sourceW, sourceH),
    c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sourceW * scale))
  c.height = Math.max(1, Math.round(sourceH * scale))
  const x = c.getContext('2d')!
  x.drawImage(image, 0, 0, c.width, c.height)
  x.globalCompositeOperation = 'source-in'
  x.fillStyle = color
  x.fillRect(0, 0, c.width, c.height)
  return c
}
export interface StrokeDynamics {
  fromScale: number
  toScale: number
  fromAlpha: number
  toAlpha: number
}
export interface BrushStrokeState {
  seed: number
  initialAngle?: number
}
export const createBrushStrokeState = (
  seed = (Math.random() * 0xffffffff) >>> 0,
): BrushStrokeState => ({ seed: seed || 0x9e3779b9 })
const nextBrushRandom = (state?: BrushStrokeState) => {
  if (!state) return Math.random()
  let x = state.seed | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.seed = x | 0
  return ((x >>> 0) + 0.5) / 4294967296
}
/** Shape/scatter dynamics. Jitter/minimum values are fractions; scatter is in diameters. */
export interface BrushShapeDynamics {
  angle: number
  roundness: number
  flipX: boolean
  flipY: boolean
  sizeJitter: number
  opacityJitter: number
  angleJitter: number
  roundnessJitter: number
  minimumDiameter: number
  minimumRoundness: number
  minimumOpacity: number
  angleControl: 'off' | 'direction' | 'initial'
  flipXJitter: boolean
  flipYJitter: boolean
  scatter: number
  bothAxes: boolean
  count: number
  countJitter: number
  state?: BrushStrokeState
}
export function strokeStamps(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  stamp: HTMLCanvasElement,
  settings: ToolSettings,
  erase: boolean,
  selection?: HTMLCanvasElement,
  clone?: { canvas: HTMLCanvasElement; offset: Point },
  dynamics?: StrokeDynamics,
  shape?: BrushShapeDynamics,
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y),
    nominal = Math.max(stamp.width, stamp.height),
    step = Math.max(0.5, (nominal * (settings.brushSpacing || 15)) / 100)
  const n = Math.min(16384, Math.max(1, Math.ceil(distance / step))),
    scratch = document.createElement('canvas')
  scratch.width = selection || clone ? stamp.width : 1
  scratch.height = selection || clone ? stamp.height : 1
  const s = scratch.getContext('2d')!,
    baseAlpha = settings.brushOpacity / 100,
    segmentAngle = Math.atan2(to.y - from.y, to.x - from.x),
    directionX = distance > 0.001 ? Math.cos(segmentAngle) : 1,
    directionY = distance > 0.001 ? Math.sin(segmentAngle) : 0
  if (shape?.state && distance > 0.001 && shape.state.initialAngle === undefined)
    shape.state.initialAngle = (segmentAngle * 180) / Math.PI
  let dabCanvas: HTMLCanvasElement | undefined
  const drawTransformed = (
    image: HTMLCanvasElement,
    cx: number,
    cy: number,
    dw: number,
    dh: number,
    angleRad: number,
    roundness: number,
    flipX: boolean,
    flipY: boolean,
  ) => {
    const sx = flipX ? -1 : 1,
      sy = (flipY ? -1 : 1) * Math.max(0.01, roundness)
    if (selection && shape && !clone) {
      const bw = Math.max(
          1,
          Math.ceil(Math.abs(dw * Math.cos(angleRad)) + Math.abs(dh * sy * Math.sin(angleRad))) + 2,
        ),
        bh = Math.max(
          1,
          Math.ceil(Math.abs(dw * Math.sin(angleRad)) + Math.abs(dh * sy * Math.cos(angleRad))) + 2,
        )
      if (!dabCanvas) dabCanvas = document.createElement('canvas')
      if (dabCanvas.width !== bw || dabCanvas.height !== bh) {
        dabCanvas.width = bw
        dabCanvas.height = bh
      }
      const d = dabCanvas.getContext('2d')!
      d.clearRect(0, 0, bw, bh)
      d.save()
      d.translate(bw / 2, bh / 2)
      d.rotate(angleRad)
      d.scale(sx, sy)
      d.drawImage(image, -dw / 2, -dh / 2, dw, dh)
      d.restore()
      d.globalCompositeOperation = 'destination-in'
      d.drawImage(selection, -(cx - bw / 2), -(cy - bh / 2))
      d.globalCompositeOperation = 'source-over'
      ctx.drawImage(dabCanvas, cx - bw / 2, cy - bh / 2)
      return
    }
    if (!angleRad && sy === 1 && sx === 1) {
      ctx.drawImage(image, cx - dw / 2, cy - dh / 2, dw, dh)
      return
    }
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angleRad)
    ctx.scale(sx, sy)
    ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }
  ctx.save()
  ctx.globalAlpha = baseAlpha
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  for (let i = 1; i <= n; i++) {
    const t = dynamics ? i / n : 0,
      pressureScale = dynamics
        ? Math.max(0.01, dynamics.fromScale + (dynamics.toScale - dynamics.fromScale) * t)
        : 1,
      pressureAlpha = dynamics
        ? dynamics.fromAlpha + (dynamics.toAlpha - dynamics.fromAlpha) * t
        : 1,
      baseCx = from.x + ((to.x - from.x) * i) / n,
      baseCy = from.y + ((to.y - from.y) * i) / n
    let copies = 1
    if (shape && !clone) {
      const countJitter = Math.min(1, Math.max(0, shape.countJitter))
      copies = Math.max(
        1,
        Math.round(
          Math.min(16, Math.max(1, shape.count)) *
            (countJitter ? 1 - countJitter * nextBrushRandom(shape.state) : 1),
        ),
      )
    }
    for (let copy = 0; copy < copies; copy++) {
      let cx = baseCx,
        cy = baseCy,
        sizeFactor = 1,
        alphaFactor = 1,
        angleDeg = 0,
        roundness = 1,
        flipX = false,
        flipY = false
      if (shape && !clone) {
        const sizeR = nextBrushRandom(shape.state),
          opacityR = nextBrushRandom(shape.state),
          angleR = nextBrushRandom(shape.state),
          roundR = nextBrushRandom(shape.state),
          flipXR = nextBrushRandom(shape.state),
          flipYR = nextBrushRandom(shape.state),
          scatterR1 = nextBrushRandom(shape.state),
          scatterR2 = nextBrushRandom(shape.state),
          minDiameter = Math.min(1, Math.max(0, shape.minimumDiameter)),
          minOpacity = Math.min(1, Math.max(0, shape.minimumOpacity)),
          minRoundness = Math.min(1, Math.max(0.01, shape.minimumRoundness))
        sizeFactor =
          minDiameter + (1 - minDiameter) * (1 - Math.min(1, Math.max(0, shape.sizeJitter)) * sizeR)
        alphaFactor =
          minOpacity +
          (1 - minOpacity) * (1 - Math.min(1, Math.max(0, shape.opacityJitter)) * opacityR)
        angleDeg = shape.angle
        if (shape.angleControl === 'direction') angleDeg += (segmentAngle * 180) / Math.PI
        if (shape.angleControl === 'initial')
          angleDeg += shape.state?.initialAngle ?? (segmentAngle * 180) / Math.PI
        angleDeg += (angleR * 2 - 1) * 180 * Math.min(1, Math.max(0, shape.angleJitter))
        roundness = Math.max(
          minRoundness,
          Math.min(1, Math.max(0.01, shape.roundness)) *
            (1 - Math.min(1, Math.max(0, shape.roundnessJitter)) * roundR),
        )
        flipX = shape.flipX !== (shape.flipXJitter && flipXR < 0.5)
        flipY = shape.flipY !== (shape.flipYJitter && flipYR < 0.5)
        const scatterAmount = Math.max(0, shape.scatter) * nominal * pressureScale,
          along = shape.bothAxes ? (scatterR1 * 2 - 1) * scatterAmount : 0,
          across = (scatterR2 * 2 - 1) * scatterAmount
        cx += directionX * along - directionY * across
        cy += directionY * along + directionX * across
      }
      const dw = Math.max(1, stamp.width * pressureScale * sizeFactor),
        dh = Math.max(1, stamp.height * pressureScale * sizeFactor),
        x = cx - dw / 2,
        y = cy - dh / 2
      let image = stamp
      if ((selection && !shape) || clone) {
        s.clearRect(0, 0, scratch.width, scratch.height)
        s.globalCompositeOperation = 'source-over'
        if (clone) {
          s.drawImage(clone.canvas, -(x + clone.offset.x), -(y + clone.offset.y))
          s.globalCompositeOperation = 'destination-in'
          s.drawImage(stamp, 0, 0)
        } else s.drawImage(stamp, 0, 0)
        if (selection) {
          s.globalCompositeOperation = 'destination-in'
          s.drawImage(selection, -x, -y)
        }
        image = scratch
      }
      ctx.globalAlpha = Math.min(1, Math.max(0, baseAlpha * pressureAlpha * alphaFactor))
      if (shape && !clone)
        drawTransformed(image, cx, cy, dw, dh, (angleDeg * Math.PI) / 180, roundness, flipX, flipY)
      else if (dynamics || stamp.width !== dw || stamp.height !== dh)
        ctx.drawImage(image, x, y, dw, dh)
      else ctx.drawImage(image, x, y)
    }
  }
  ctx.restore()
}

/**
 * Retouch dabs along one pointer segment, in the target canvas' own pixel
 * grid. Each dab reads only its bounding box (plus a 2px halo for the 3x3
 * neighbourhoods) so large layers stay interactive. `selectionAlpha` is the
 * full-canvas selection alpha when a selection limits the stroke.
 */
export function retouchStroke(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  diameter: number,
  tool: RetouchTool,
  settings: ToolSettings,
  selectionAlpha?: Uint8ClampedArray,
) {
  const canvas = ctx.canvas,
    radius = Math.max(0.5, diameter / 2),
    halo = 2,
    distance = Math.hypot(to.x - from.x, to.y - from.y),
    step = Math.max(1, (diameter * (settings.brushSpacing || 15)) / 100),
    n = Math.min(4096, Math.max(1, Math.ceil(distance / step)))
  for (let i = 1; i <= n; i++) {
    const cx = from.x + ((to.x - from.x) * i) / n,
      cy = from.y + ((to.y - from.y) * i) / n,
      bx = Math.max(0, Math.floor(cx - radius - halo)),
      by = Math.max(0, Math.floor(cy - radius - halo)),
      bw = Math.min(canvas.width - bx, Math.ceil(cx + radius + halo) - bx),
      bh = Math.min(canvas.height - by, Math.ceil(cy + radius + halo) - by)
    if (bw < 1 || bh < 1) continue
    const image = ctx.getImageData(bx, by, bw, bh)
    let mask: Uint8ClampedArray | undefined
    if (selectionAlpha) {
      mask = new Uint8ClampedArray(bw * bh)
      for (let y = 0; y < bh; y++)
        mask.set(
          selectionAlpha.subarray((by + y) * canvas.width + bx, (by + y) * canvas.width + bx + bw),
          y * bw,
        )
    }
    applyRetouchDab(image.data, bw, bh, {
      tool,
      cx: cx - bx,
      cy: cy - by,
      radius,
      hardness: (settings.brushHardness ?? 100) / 100,
      strength: Math.min(1, Math.max(0, (settings.retouchStrength ?? 30) / 100)),
      range: settings.retouchRange || 'midtones',
      spongeMode: settings.spongeMode || 'desaturate',
      moveX: (to.x - from.x) / n,
      moveY: (to.y - from.y) / n,
      mask,
    })
    ctx.putImageData(image, bx, by)
  }
}
