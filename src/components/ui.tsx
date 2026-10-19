import { evaluateNumericInput } from '../engine/numericExpression'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, X, type LucideIcon } from 'lucide-react'

export function IconButton({
  icon: Icon,
  label,
  active,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
}) {
  return (
    <button
      {...props}
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      aria-label={label}
      title={label}
    >
      <Icon size={17} strokeWidth={1.7} />
      {children}
    </button>
  )
}
export function Field({
  label,
  value,
  onChange,
  onCommit,
  min = -16384,
  max = 16384,
  step = 1,
  suffix,
  disabled,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  onCommit?: () => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  const format = (n: number) => String(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)
  const [text, setText] = useState(() => format(value)),
    [focused, setFocused] = useState(false),
    [error, setError] = useState('')
  const base = useRef(value),
    draft = useRef(text),
    cancelled = useRef(false),
    edited = useRef(false),
    current = useRef(value)
  current.current = value
  useLayoutEffect(() => {
    if (!focused) {
      const next = format(value)
      draft.current = next
      setText(next)
    }
  }, [value, focused])
  const apply = (raw: string) => {
    const n = Math.max(min, Math.min(max, evaluateNumericInput(raw, base.current, suffix)))
    if (n !== current.current) onChange(n)
    return n
  }
  const update = (raw: string) => {
    edited.current = true
    draft.current = raw
    setText(raw)
    setError('')
    try {
      apply(raw)
    } catch {
      /* Incomplete expression is only a draft; never write NaN. */
    }
  }
  return (
    <label
      className={`number-field ${error ? 'invalid-number' : ''}`}
      title={
        error ||
        'Число или выражение: 1600/2, (40+12)*2, +=10. Enter — применить; Escape — отменить.'
      }
    >
      <span>{label}</span>
      <input
        aria-label={label}
        type="text"
        role="spinbutton"
        inputMode="decimal"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-invalid={!!error}
        value={text}
        disabled={disabled}
        onFocus={() => {
          base.current = value
          edited.current = false
          cancelled.current = false
          setFocused(true)
          setError('')
        }}
        onChange={(e) => update(e.target.value)}
        onBlur={() => {
          if (!cancelled.current && edited.current) {
            try {
              apply(draft.current)
            } catch (e) {
              onChange(base.current)
              setError(e instanceof Error ? e.message : 'Некорректное выражение')
            }
          }
          cancelled.current = false
          setFocused(false)
          onCommit?.()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancelled.current = true
            onChange(base.current)
            setError('')
            draft.current = format(base.current)
            setText(draft.current)
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            const amount = step * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
            update(
              String(
                Math.max(min, Math.min(max, Math.round((current.current + amount) * 1e8) / 1e8)),
              ),
            )
          }
        }}
      />
      {suffix && <span className="field-suffix">{suffix}</span>}
    </label>
  )
}

export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  suffix = '',
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (n: number) => void
  onCommit?: () => void
  suffix?: string
}) {
  return (
    <label className="slider-field">
      <span className="slider-title">
        <span>{label}</span>
        <span className="slider-value">
          {Math.round(value)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(+e.target.value)}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
        style={{ '--range-fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
    </label>
  )
}
export function Select({
  children,
  className = '',
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={`select-wrap ${className}`}>
      <select {...props}>{children}</select>
      <ChevronDown size={12} />
    </span>
  )
}
export function ColorField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
}) {
  return (
    <label className="color-field">
      <span className="color-swatch" style={{ background: value }}>
        <input
          type="color"
          aria-label={label}
          value={value === 'transparent' ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
        />
      </span>
      <span>{value.toUpperCase()}</span>
      <span className="color-percent">100%</span>
    </label>
  )
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    const node = ref.current!
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href], [tabindex="0"]',
        ),
      )
    ;(node.querySelector<HTMLElement>('[autofocus],[data-autofocus]') || focusable()[0])?.focus()
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const targets = focusable()
        const first = targets[0],
          last = targets.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    node.addEventListener('keydown', handler)
    return () => {
      node.removeEventListener('keydown', handler)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="Закрыть окно" onClick={onClose} />
        </header>
        {children}
      </div>
    </div>
  )
}
