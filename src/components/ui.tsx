import { useEffect, useRef, type ReactNode } from 'react'
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
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== '' && Number.isFinite(+e.target.value))
            onChange(Math.min(max, Math.max(min, +e.target.value)))
        }}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
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
    focusable()[0]?.focus()
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
