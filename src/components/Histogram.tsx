import { useEffect, useState } from 'react'
import type { EditorDocument } from '../types'
import { exportCanvas } from '../engine/render'
import { histogram, type HistogramData } from '../engine/adjustmentMath'
import type { ToneChannel } from '../engine/adjustmentTypes'
export function Histogram({
  doc,
  channel = 'rgb',
}: {
  doc: EditorDocument
  channel?: ToneChannel
}) {
  const [data, setData] = useState<HistogramData | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const timer = setTimeout(() => {
      void exportCanvas(doc, Math.min(1, 384 / Math.max(doc.width, doc.height)))
        .then((c) => {
          if (!active) return
          setData(
            histogram(
              c
                .getContext('2d', { willReadFrequently: true })!
                .getImageData(0, 0, c.width, c.height).data,
            ),
          )
          setError('')
        })
        .catch(() => {
          if (active) {
            setData(null)
            setError('Гистограмма недоступна для этого документа')
          }
        })
    }, 140)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [doc])
  const bins = data?.[channel],
    max = Math.max(1, ...(bins || []))
  const points = bins
    ? `0,64 ${bins.map((v, i) => `${i},${64 - 64 * Math.sqrt(v / max)}`).join(' ')} 255,64`
    : ''
  return (
    <div className="histogram" data-testid="histogram" aria-label="Гистограмма композита">
      <svg viewBox="0 0 255 64" role="img" aria-label={`Гистограмма ${channel.toUpperCase()}`}>
        <polygon points={points} className={`histogram-${channel}`} />
      </svg>
      <p className="panel-note">
        {error ||
          (data
            ? 'Текущий композит · предпросмотр до 384 px · alpha учитывается'
            : 'Расчёт гистограммы…')}
      </p>
    </div>
  )
}
