import { useRef, useState } from 'react'
import type { CurvePoint } from '../engine/adjustmentTypes'
import { curveValue } from '../engine/adjustmentMath'
import { Field } from './ui'
export function CurveEditor({
  points,
  onChange,
  onFinish,
}: {
  points: CurvePoint[]
  onChange: (points: CurvePoint[]) => void
  onFinish: () => void
}) {
  const [selected, setSelected] = useState(0),
    drag = useRef<number | null>(null),
    current = useRef(points)
  current.current = points
  const index = Math.min(selected, points.length - 1),
    point = points[index]
  const update = (i: number, input: number, output: number) => {
    const value = current.current
    const x =
      i === 0 || i === value.length - 1
        ? value[i].input
        : Math.max(value[i - 1].input + 1, Math.min(value[i + 1].input - 1, Math.round(input)))
    const next = value.map((p, n) =>
      n === i ? { input: x, output: Math.max(0, Math.min(255, Math.round(output))) } : p,
    )
    current.current = next
    onChange(next)
  }
  const position = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return {
      input: Math.max(0, Math.min(255, Math.round(((e.clientX - box.left) * 255) / box.width))),
      output: Math.max(
        0,
        Math.min(255, Math.round(255 - ((e.clientY - box.top) * 255) / box.height)),
      ),
    }
  }
  const remove = () => {
    if (index === 0 || index === points.length - 1 || points.length <= 2) return
    onChange(points.filter((_, i) => i !== index))
    setSelected(index - 1)
    onFinish()
  }
  return (
    <div className="curve-editor">
      <svg
        className="tone-curve"
        viewBox="0 0 255 255"
        aria-label="Редактор кривой"
        role="group"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.stopPropagation()
          const p = position(e),
            match = points.findIndex((v) => Math.hypot(v.input - p.input, v.output - p.output) < 10)
          let i = match
          if (i < 0) {
            if (
              points.length >= 16 ||
              points.some((v) => v.input === p.input) ||
              p.input <= points[0].input ||
              p.input >= points[points.length - 1].input
            )
              return
            const next = [...points, p].sort((a, b) => a.input - b.input)
            i = next.indexOf(p)
            current.current = next
            onChange(next)
          }
          setSelected(i)
          drag.current = i
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (drag.current !== null) {
            const p = position(e)
            update(drag.current, p.input, p.output)
          }
        }}
        onPointerUp={(e) => {
          if (drag.current !== null) {
            drag.current = null
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId)
            onFinish()
          }
        }}
        onPointerCancel={() => {
          drag.current = null
          onFinish()
        }}
      >
        {[0, 64, 128, 192, 255].map((n) => (
          <g key={n} className="curve-grid">
            <line x1={n} x2={n} y1="0" y2="255" />
            <line x1="0" x2="255" y1={n} y2={n} />
          </g>
        ))}
        <path d="M0 255L255 0" className="curve-diagonal" />
        <polyline
          points={Array.from({ length: 256 }, (_, x) => `${x},${255 - curveValue(points, x)}`).join(
            ' ',
          )}
          className="curve-line"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.input}
            cy={255 - p.output}
            r={i === index ? 5 : 4}
            className={i === index ? 'curve-anchor active' : 'curve-anchor'}
            tabIndex={0}
            role="button"
            aria-label={`Точка ${i + 1}: ${p.input} → ${p.output}`}
            onFocus={() => setSelected(i)}
            onKeyDown={(e) => {
              if (
                ![
                  'ArrowUp',
                  'ArrowDown',
                  'ArrowLeft',
                  'ArrowRight',
                  'Delete',
                  'Backspace',
                ].includes(e.key)
              )
                return
              e.preventDefault()
              e.stopPropagation()
              if (e.key === 'Delete' || e.key === 'Backspace') {
                remove()
                return
              }
              const d = e.shiftKey ? 10 : 1
              update(
                i,
                p.input + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0),
                p.output + (e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0),
              )
              onFinish()
            }}
          />
        ))}
      </svg>
      <div className="field-grid">
        <Field
          label="Вход кривой"
          value={point.input}
          min={index ? points[index - 1].input + 1 : 0}
          max={index < points.length - 1 ? points[index + 1].input - 1 : 255}
          disabled={index === 0 || index === points.length - 1}
          onChange={(v) => update(index, v, point.output)}
          onCommit={onFinish}
        />
        <Field
          label="Выход кривой"
          value={point.output}
          min={0}
          max={255}
          onChange={(v) => update(index, point.input, v)}
          onCommit={onFinish}
        />
      </div>
      <button
        className="text-button"
        disabled={index === 0 || index === points.length - 1}
        onClick={remove}
      >
        Удалить выбранную точку
      </button>
      <p className="panel-note">
        Клик добавляет точку; перетаскивание меняет кривую. Стрелки ±1, Shift ±10, Delete удаляет
        точку. До 16 точек на канал.
      </p>
    </div>
  )
}
