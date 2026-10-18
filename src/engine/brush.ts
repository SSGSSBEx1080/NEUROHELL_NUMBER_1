import type { Point, ToolSettings } from '../types'
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
export function strokeStamps(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  stamp: HTMLCanvasElement,
  settings: ToolSettings,
  erase: boolean,
  selection?: HTMLCanvasElement,
  clone?: { canvas: HTMLCanvasElement; offset: Point },
) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y),
    step = Math.max(0.5, (stamp.width * (settings.brushSpacing || 15)) / 100)
  const n = Math.min(16384, Math.max(1, Math.ceil(distance / step))),
    scratch = document.createElement('canvas')
  scratch.width = selection || clone ? stamp.width : 1
  scratch.height = selection || clone ? stamp.height : 1
  const s = scratch.getContext('2d')!,
    r = stamp.width / 2
  ctx.save()
  ctx.globalAlpha = settings.brushOpacity / 100
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  for (let i = 1; i <= n; i++) {
    const x = from.x + ((to.x - from.x) * i) / n - r,
      y = from.y + ((to.y - from.y) * i) / n - r
    let image = stamp
    if (selection || clone) {
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
    ctx.drawImage(image, x, y)
  }
  ctx.restore()
}
