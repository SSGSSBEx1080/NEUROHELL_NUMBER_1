import { useEffect, useRef } from 'react'
import type { Selection } from '../types'
import { selectionCoverage } from '../engine/selection'
export function QuickMaskOverlay({
  selection,
  width,
  height,
}: {
  selection: Selection | null
  width: number
  height: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current!,
      x = c.getContext('2d')!,
      coverage = selectionCoverage(selection, width, height, 255),
      image = x.createImageData(width, height)
    for (let i = 0; i < coverage.length; i++) {
      image.data[i * 4] = 255
      image.data[i * 4 + 1] = 54
      image.data[i * 4 + 2] = 83
      image.data[i * 4 + 3] = Math.round((255 - coverage[i]) * 0.55)
    }
    x.putImageData(image, 0, 0)
  }, [selection, width, height])
  return (
    <canvas
      ref={canvas}
      className="quick-mask-overlay"
      data-testid="quick-mask-overlay"
      aria-label="Быстрая маска: красным показана исключённая область"
      width={width}
      height={height}
    />
  )
}
