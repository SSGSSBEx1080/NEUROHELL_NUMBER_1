import { useEffect, useRef, useState, type ReactNode } from 'react'
import { GripHorizontal, PanelLeft, PanelRight, PanelsTopLeft, Pin, RotateCcw } from 'lucide-react'
import {
  defaultPanelLayout,
  normalizePanelLayout,
  panelPreset,
  visiblePanelLayout,
  type DockTab,
  type PanelLayout,
} from '../engine/panelLayout'
import { IconButton, Select } from './ui'
interface Props {
  value: PanelLayout
  onChange: (value: PanelLayout) => void
  properties: ReactNode
  translation: ReactNode
  actions: ReactNode
  layers: ReactNode
  footer: ReactNode
}
type Gesture = 'width' | 'split' | 'move' | 'corner'
export function PanelDock({
  value,
  onChange,
  properties,
  translation,
  actions,
  layers,
  footer,
}: Props) {
  const [viewport, setViewport] = useState({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
    [preview, setPreview] = useState<PanelLayout | null>(null)
  const displayed = visiblePanelLayout(preview || value, viewport)
  const root = useRef<HTMLElement>(null),
    drag = useRef<{
      kind: Gesture
      x: number
      y: number
      origin: PanelLayout
      height: number
    } | null>(null),
    raf = useRef(0)
  const latest = useRef<PanelLayout | null>(null)
  useEffect(() => {
    const resized = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('resize', resized)
      cancelAnimationFrame(raf.current)
    }
  }, [])
  const patch = (p: Partial<PanelLayout>) =>
    onChange(normalizePanelLayout({ ...displayed, ...p, preset: 'custom' }))
  const begin = (e: React.PointerEvent<HTMLElement>, kind: Gesture) => {
    if (e.button !== 0 || (kind === 'move' && !displayed.floating)) return
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      kind,
      x: e.clientX,
      y: e.clientY,
      origin: displayed,
      height: Math.max(100, root.current!.clientHeight - 100),
    }
    latest.current = displayed
  }
  const calculate = (x: number, y: number) => {
    const d = drag.current!
    const dx = x - d.x,
      dy = y - d.y
    const next = { ...d.origin, preset: 'custom' as const }
    if (d.kind === 'width') next.width += dx * (next.floating || next.side === 'left' ? 1 : -1)
    if (d.kind === 'split') next.split += dy / d.height
    if (d.kind === 'move') {
      next.x += dx
      next.y += dy
    }
    if (d.kind === 'corner') {
      next.width += dx
      next.height += dy
    }
    return visiblePanelLayout(normalizePanelLayout(next), viewport)
  }
  const move = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag.current) return
    latest.current = calculate(e.clientX, e.clientY)
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        setPreview(latest.current)
      })
  }
  const finish = (e: React.PointerEvent<HTMLElement>, cancel = false) => {
    if (!drag.current) return
    cancelAnimationFrame(raf.current)
    raf.current = 0
    if (!cancel) onChange(calculate(e.clientX, e.clientY))
    drag.current = null
    latest.current = null
    setPreview(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const events = (kind: Gesture) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => begin(e, kind),
    onPointerMove: move,
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => finish(e),
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => finish(e, true),
  })
  const key = (e: React.KeyboardEvent, kind: Gesture) => {
    if (e.key === 'Escape' && drag.current) {
      e.preventDefault()
      e.stopPropagation()
      cancelAnimationFrame(raf.current)
      raf.current = 0
      drag.current = null
      latest.current = null
      setPreview(null)
      return
    }
    if (!e.key.startsWith('Arrow')) return
    e.preventDefault()
    const delta = e.shiftKey ? 40 : 10,
      dx = e.key === 'ArrowLeft' ? -delta : e.key === 'ArrowRight' ? delta : 0,
      dy = e.key === 'ArrowUp' ? -delta : e.key === 'ArrowDown' ? delta : 0
    if (kind === 'move') patch({ x: displayed.x + dx, y: displayed.y + dy })
    else if (kind === 'split') patch({ split: displayed.split + dy / 500 })
    else
      patch({
        width:
          displayed.width +
          (kind === 'width' && !displayed.floating && displayed.side === 'right' ? -dx : dx),
        ...(kind === 'corner' ? { height: displayed.height + dy } : {}),
      })
  }
  const tabs: [DockTab, string][] = [
    ['properties', 'Слой'],
    ['translation', 'Перевод'],
    ['actions', 'Операции'],
  ]
  return (
    <aside
      ref={root}
      className={`inspector panel-dock ${displayed.floating ? 'floating-panels' : ''} dock-${displayed.side}`}
      aria-label="Свойства и слои"
      style={{
        width: displayed.width,
        ...(displayed.floating
          ? { left: displayed.x, top: displayed.y, height: displayed.height }
          : {}),
      }}
    >
      <div className="dock-window-heading">
        <button
          className="dock-grip"
          aria-label="Переместить панели"
          disabled={!displayed.floating}
          {...events('move')}
          onKeyDown={(e) => key(e, 'move')}
          title="Плавающее окно: потяни или используй стрелки"
        >
          <GripHorizontal size={14} />
        </button>
        <Select
          aria-label="Рабочая среда"
          value={displayed.preset}
          onChange={(e) => onChange(panelPreset(e.target.value as PanelLayout['preset']))}
        >
          <option value="retouch">Ретушь</option>
          <option value="manga">Манга</option>
          <option value="type">Тайпсет</option>
          <option value="custom" disabled>
            Своя среда
          </option>
        </Select>
        <IconButton
          icon={displayed.side === 'left' ? PanelRight : PanelLeft}
          label={displayed.side === 'left' ? 'Панели справа' : 'Панели слева'}
          onClick={() =>
            patch({ side: displayed.side === 'left' ? 'right' : 'left', floating: false })
          }
        />
        <IconButton
          icon={displayed.floating ? Pin : PanelsTopLeft}
          label={displayed.floating ? 'Закрепить панели' : 'Открепить панели'}
          onClick={() => patch({ floating: !displayed.floating })}
        />
        <IconButton
          icon={RotateCcw}
          label="Сбросить рабочую среду"
          onClick={() => onChange({ ...defaultPanelLayout })}
        />
      </div>
      <div className="dock-tabs" role="tablist" aria-label="Панели редактора">
        {tabs.map(([id, label], index) => (
          <button
            key={id}
            id={`dock-tab-${id}`}
            role="tab"
            aria-selected={displayed.tab === id}
            aria-controls={`dock-view-${id}`}
            tabIndex={displayed.tab === id ? 0 : -1}
            onClick={() => patch({ tab: id })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                const next = tabs[(index + (e.key === 'ArrowLeft' ? 2 : 1)) % 3][0]
                patch({ tab: next })
                document.getElementById(`dock-tab-${next}`)?.focus()
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="dock-upper" style={{ flex: displayed.split }}>
        {tabs.map(([id]) => (
          <div
            key={id}
            id={`dock-view-${id}`}
            role="tabpanel"
            aria-labelledby={`dock-tab-${id}`}
            className="dock-view"
            hidden={displayed.tab !== id}
          >
            {id === 'properties' ? properties : id === 'translation' ? translation : actions}
          </div>
        ))}
      </div>
      <div
        className="dock-splitter"
        role="separator"
        aria-label="Высота верхней панели"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(displayed.split * 100)}
        aria-valuemin={25}
        aria-valuemax={80}
        tabIndex={0}
        {...events('split')}
        onKeyDown={(e) => key(e, 'split')}
        onDoubleClick={() => patch({ split: 0.54 })}
      >
        <i />
      </div>
      <div className="dock-lower" style={{ flex: 1 - displayed.split }}>
        {layers}
      </div>
      {footer}
      <div
        className="dock-width-handle"
        role="separator"
        aria-label="Ширина панелей"
        aria-orientation="vertical"
        aria-valuenow={Math.round(displayed.width)}
        aria-valuemin={240}
        aria-valuemax={520}
        tabIndex={0}
        {...events('width')}
        onKeyDown={(e) => key(e, 'width')}
        onDoubleClick={() => patch({ width: 300 })}
      />
      {displayed.floating && (
        <button
          className="dock-corner"
          aria-label="Размер плавающих панелей"
          {...events('corner')}
          onKeyDown={(e) => key(e, 'corner')}
        >
          ◢
        </button>
      )}
    </aside>
  )
}
