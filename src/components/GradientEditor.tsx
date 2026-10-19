import { useRef, useState } from 'react'
import {
  GRADIENT_QUANTUM,
  MAX_GRADIENT_STOPS,
  gradientColor,
  gradientPresets,
  parseGradientStops,
  type GradientStop,
} from '../engine/gradientRamp'
import { ColorField, Field, Select } from './ui'
export function GradientEditor({
  stops,
  onChange,
  onFinish,
}: {
  stops: GradientStop[]
  onChange: (stops: GradientStop[], temporary: boolean) => void
  onFinish: () => void
}) {
  const [selected, setSelected] = useState(0),
    [error, setError] = useState(''),
    bar = useRef<HTMLDivElement>(null),
    drag = useRef<{ before: GradientStop[]; index: number } | undefined>(undefined)
  const index = Math.min(selected, stops.length - 1),
    stop = stops[index],
    min = index ? stops[index - 1].position + GRADIENT_QUANTUM : 0,
    max = index < stops.length - 1 ? stops[index + 1].position - GRADIENT_QUANTUM : 1
  const set = (values: GradientStop[], temporary = true) => {
    try {
      onChange(parseGradientStops(values), temporary)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка градиента')
    }
  }
  const place = (position: number, at = index) => {
    const lo = at ? stops[at - 1].position + GRADIENT_QUANTUM : 0,
      hi = at < stops.length - 1 ? stops[at + 1].position - GRADIENT_QUANTUM : 1
    set(
      stops.map((s, i) =>
        i === at ? { ...s, position: Math.max(lo, Math.min(hi, position)) } : s,
      ),
    )
  }
  const add = (position?: number) => {
    if (stops.length >= MAX_GRADIENT_STOPS) return
    let p = position
    if (p === undefined) {
      let width = -1
      for (let i = 0; i < stops.length - 1; i++) {
        const w = stops[i + 1].position - stops[i].position
        if (w > width) {
          width = w
          p = (stops[i].position + stops[i + 1].position) / 2
        }
      }
    }
    if (p === undefined || stops.some((s) => Math.abs(s.position - p!) < GRADIENT_QUANTUM)) return
    const rgb = [0, 0, 0]
    gradientColor(stops, p, rgb)
    const color =
        '#' +
        rgb
          .map((v) =>
            Math.round(v * 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join(''),
      next = parseGradientStops([...stops, { position: p, color }])
    set(next, false)
    setSelected(next.findIndex((s) => s.position === Math.round(p! * 4096) / 4096))
  }
  return (
    <div className="gradient-editor" data-testid="gradient-editor">
      <Select
        aria-label="Пресет карты градиента"
        value=""
        onChange={(e) => {
          const p = gradientPresets[+e.target.value]
          if (p) {
            set(p.stops, false)
            setSelected(0)
          }
        }}
      >
        <option value="" disabled>
          Выбрать палитру…
        </option>
        {gradientPresets.map((p, i) => (
          <option value={i} key={p.name}>
            {p.name}
          </option>
        ))}
      </Select>
      <div
        ref={bar}
        className="gradient-ramp"
        data-testid="gradient-ramp"
        style={{
          background: `linear-gradient(90deg in srgb,${stops.map((s) => `${s.color} ${s.position * 100}%`).join(',')})`,
        }}
        onDoubleClick={(e) => {
          if (!(e.target as Element).closest('button')) {
            const b = e.currentTarget.getBoundingClientRect()
            add(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)))
          }
        }}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            className={`gradient-stop ${i === index ? 'selected' : ''}`}
            aria-label={`Цветовая точка ${i + 1}`}
            aria-pressed={i === index}
            style={{ left: `${s.position * 100}%`, '--stop-color': s.color } as React.CSSProperties}
            onClick={() => setSelected(i)}
            onFocus={() => setSelected(i)}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSelected(i)
              drag.current = { before: stops, index: i }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
              const b = bar.current!.getBoundingClientRect()
              place((e.clientX - b.left) / b.width, drag.current.index)
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId)
              if (drag.current) {
                drag.current = undefined
                onFinish()
              }
            }}
            onPointerCancel={() => {
              const previous = drag.current
              drag.current = undefined
              if (previous) {
                set(previous.before)
                onFinish()
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                e.stopPropagation()
                place(
                  s.position +
                    (e.key === 'ArrowLeft' ? -1 : 1) * GRADIENT_QUANTUM * (e.shiftKey ? 10 : 1),
                  i,
                )
              }
              if (e.key === 'Escape' && drag.current) {
                e.preventDefault()
                const previous = drag.current
                drag.current = undefined
                set(previous.before)
                onFinish()
              }
            }}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow')) onFinish()
            }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="gradient-stop-fields">
        <ColorField
          label="Цвет точки градиента"
          value={stop.color}
          onChange={(color) => set(stops.map((s, i) => (i === index ? { ...s, color } : s)))}
          onCommit={onFinish}
        />
        <Field
          label="Позиция точки"
          value={stop.position * 100}
          min={min * 100}
          max={max * 100}
          suffix="%"
          step={0.1}
          onChange={(v) => place(v / 100)}
          onCommit={onFinish}
        />
      </div>
      <div className="path-button-grid">
        <button
          className="compact-button"
          disabled={stops.length >= MAX_GRADIENT_STOPS}
          onClick={() => add()}
        >
          Добавить цветовую точку
        </button>
        <button
          className="compact-button"
          disabled={stops.length <= 2}
          onClick={() => {
            set(
              stops.filter((_, i) => i !== index),
              false,
            )
            setSelected(Math.max(0, index - 1))
          }}
        >
          Удалить цветовую точку
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <p className="panel-note">
        2–16 цветов, непрозрачные точки. Перетаскивание/стрелки меняют позицию; двойной клик по
        полосе добавляет цвет. Классическая линейная RGB-интерполяция.
      </p>
    </div>
  )
}
