import { useEffect, useRef, useState } from 'react'
import { Check, type LucideIcon } from 'lucide-react'

export interface MenuItem {
  label: string
  action: () => void
  icon?: LucideIcon
  shortcut?: string
  disabled?: boolean
  checked?: boolean
  divider?: boolean
}
export function Dropdown({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setOpen(false)
        root.current?.querySelector('button')?.focus()
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = Array.from(
          root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ||
            [],
        )
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  return (
    <div ref={root} className="dropdown">
      <button
        className={`menu-trigger ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {open && (
        <div className="dropdown-menu context-menu" role="menu">
          {items.map((item, i) => (
            <div key={i}>
              {item.divider && <div className="menu-divider" />}
              <button
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.action()
                  setOpen(false)
                }}
              >
                {item.checked !== undefined ? (
                  item.checked ? (
                    <Check size={14} />
                  ) : (
                    <span className="menu-icon-space" />
                  )
                ) : item.icon ? (
                  <item.icon size={14} />
                ) : (
                  <span className="menu-icon-space" />
                )}
                {item.label}
                {item.shortcut && <span>{item.shortcut}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
