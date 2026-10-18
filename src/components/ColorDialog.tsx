import { useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { Field, Modal } from './ui'

export function hexToHsv(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min
  const h =
    d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max ? d / max : 0, v: max }
}
export function hsvToHex(h: number, s: number, v: number) {
  const c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return (
    '#' +
    rgb
      .map((n) =>
        Math.round((n + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}
const swatches = [
  '#ffffff',
  '#16131c',
  '#b6a3ff',
  '#ef92b6',
  '#ff7a53',
  '#f2cb76',
  '#c4e5b3',
  '#74cabc',
  '#8cb7f1',
  '#665de7',
  '#a35d9b',
  '#be9d87',
]
export function ColorDialog({
  color,
  onClose,
  onApply,
}: {
  color: string
  onClose: () => void
  onApply: (color: string) => void
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(color)),
    [hexDraft, setHexDraft] = useState(color)
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v),
    rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const update = (v: typeof hsv) => {
    setHsv(v)
    setHexDraft(hsvToHex(v.h, v.s, v.v))
  }
  const choose = (hex: string) => {
    setHexDraft(hex)
    setHsv(hexToHsv(hex))
  }
  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    update({
      ...hsv,
      s: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      v: 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    })
  }
  return (
    <Modal
      title="Найди свой цвет"
      subtitle="Точный выбор. Никаких случайных оттенков."
      onClose={onClose}
    >
      <div
        className="color-sv"
        role="slider"
        tabIndex={0}
        aria-label="Насыщенность и яркость цвета"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Насыщенность ${Math.round(hsv.s * 100)}, яркость ${Math.round(hsv.v * 100)}`}
        style={{ backgroundColor: `hsl(${hsv.h},100%,50%)` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          point(e)
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e)
        }}
        onKeyDown={(e) => {
          if (e.key.startsWith('Arrow')) {
            e.preventDefault()
            update({
              ...hsv,
              s: Math.max(
                0,
                Math.min(
                  1,
                  hsv.s + (e.key === 'ArrowRight' ? 0.01 : e.key === 'ArrowLeft' ? -0.01 : 0),
                ),
              ),
              v: Math.max(
                0,
                Math.min(
                  1,
                  hsv.v + (e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowDown' ? -0.01 : 0),
                ),
              ),
            })
          }
        }}
      >
        <span style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <input
        className="hue-slider"
        type="range"
        min={0}
        max={359.99}
        step={0.01}
        value={hsv.h}
        aria-label="Цветовой тон палитры"
        onChange={(e) => update({ ...hsv, h: +e.target.value })}
      />
      <div className="color-values">
        <div className="color-comparison">
          <span style={{ background: color }} title="Исходный цвет" />
          <span style={{ background: hex }} title="Новый цвет" />
        </div>
        <label className="number-field">
          <span>HEX</span>
          <input
            aria-label="HEX цвета"
            value={hexDraft.toUpperCase()}
            maxLength={7}
            onChange={(e) => {
              let v = e.target.value
              if (!v.startsWith('#')) v = '#' + v
              setHexDraft(v)
              if (/^#[a-f0-9]{6}$/i.test(v)) setHsv(hexToHsv(v))
            }}
            onBlur={() => setHexDraft(hex)}
          />
        </label>
      </div>
      <div className="rgb-fields">
        {['R', 'G', 'B'].map((name, i) => (
          <Field
            key={name}
            label={name}
            value={rgb[i]}
            min={0}
            max={255}
            onChange={(v) => {
              const channels = [...rgb]
              channels[i] = Math.round(v)
              choose('#' + channels.map((c) => c.toString(16).padStart(2, '0')).join(''))
            }}
          />
        ))}
      </div>
      <div className="swatch-heading">
        <Palette size={14} />
        Студийная палитра
      </div>
      <div className="color-swatches">
        {swatches.map((c) => (
          <button
            key={c}
            title={c}
            aria-label={`Выбрать ${c}`}
            style={{ background: c }}
            onClick={() => choose(c)}
          >
            {hex === c && <Check size={13} color={c === '#16131c' ? '#ffffff' : '#282132'} />}
          </button>
        ))}
      </div>
      <footer className="dialog-footer">
        <span>RGB · sRGB · {hex.toUpperCase()}</span>
        <button className="primary-button" onClick={() => onApply(hex)}>
          Применить цвет
          <Check size={15} />
        </button>
      </footer>
    </Modal>
  )
}
