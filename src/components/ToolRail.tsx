import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Circle, Crop, Eraser, Hand, Lasso, Magnet, MousePointer2, Paintbrush, PaintBucket, Pipette, ScanLine, Square, SquareDashed, Stamp, Type, WandSparkles, Spline, Blend, ChevronRight } from 'lucide-react'
import type { Tool } from '../types'
const groups = [
  [{ id: 'move', name: 'Перемещение', icon: MousePointer2, key: 'V' }],
  [{ id: 'select', name: 'Прямоугольное выделение', icon: SquareDashed, key: 'M' }, { id: 'ellipse-select', name: 'Овальное выделение', icon: Circle, key: 'M' }],
  [{ id: 'lasso', name: 'Лассо', icon: Lasso, key: 'L' }, { id: 'polygon-lasso', name: 'Прямолинейное лассо', icon: Spline, key: 'L' }, { id: 'magnetic-lasso', name: 'Магнитное лассо', icon: Magnet, key: 'L' }],
  [{ id: 'crop', name: 'Кадрирование', icon: Crop, key: 'C' }],
  [{ id: 'brush', name: 'Кисть', icon: Paintbrush, key: 'B' }],
  [{ id: 'clone', name: 'Штамп', icon: Stamp, key: 'S' }],
  [{ id: 'eraser', name: 'Ластик', icon: Eraser, key: 'E' }, { id: 'wand', name: 'Волшебный ластик', icon: WandSparkles, key: 'E' }],
  [{ id: 'bucket', name: 'Заливка', icon: PaintBucket, key: 'G' }, { id: 'gradient', name: 'Градиент', icon: Blend, key: 'G' }],
  [{ id: 'text', name: 'Текст', icon: Type, key: 'T' }],
  [{ id: 'rectangle', name: 'Прямоугольник', icon: Square, key: 'U' }, { id: 'ellipse', name: 'Эллипс', icon: Circle, key: 'U' }],
  [{ id: 'eyedropper', name: 'Пипетка', icon: Pipette, key: 'I' }],
  [{ id: 'hand', name: 'Рука', icon: Hand, key: 'H' }],
] satisfies { id: Tool; name: string; icon: typeof ScanLine; key: string }[][]
export const TOOLS = groups.flat()
export const selectionTools: Tool[] = ['select', 'ellipse-select', 'lasso', 'polygon-lasso', 'magnetic-lasso']
export function cycleTool(tool: Tool, key: string, cycle: boolean): Tool | undefined {
  const group = groups.find(g => g.some(t => t.key === key)); if (!group) return
  const index = group.findIndex(t => t.id === tool)
  return group[cycle && index >= 0 ? (index + 1) % group.length : 0].id
}
export function ToolRail({ tool, onSelect }: { tool: Tool; onSelect: (tool: Tool) => void }) {
  const [last, setLast] = useState<Record<string, Tool>>({}), [menu, setMenu] = useState<{ group: number; x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), long = useRef(false), popup = useRef<HTMLDivElement>(null)
  const choose = (id: Tool, group: number) => { setLast(v => ({ ...v, [group]: id })); onSelect(id); setMenu(null) }
  useEffect(() => {
    if (!menu) return
    const close = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node)) setMenu(null) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [menu])
  useEffect(() => () => clearTimeout(timer.current), [])
  return <><div className="tool-list tool-list-pro">{groups.map((group, index) => {
    const active = group.find(t => t.id === tool), item = active || group.find(t => t.id === last[index]) || group[0]
    const open = (el: HTMLElement) => { const b = el.getBoundingClientRect(); setMenu({ group: index, x: b.right + 7, y: Math.min(b.top, window.innerHeight - group.length * 42 - 24) }) }
    return <button key={index} className={`tool-button ${active ? 'selected active' : ''}`} data-tool={item.id} aria-label={item.name} aria-pressed={!!active} title={`${item.name} (${item.key})${group.length > 1 ? ' · ПКМ: подтипы · Shift+' + item.key : ''}`}
      onContextMenu={e => { e.preventDefault(); open(e.currentTarget) }}
      onPointerDown={e => { long.current = false; if (e.button === 0 && group.length > 1) { const el = e.currentTarget; timer.current = setTimeout(() => { long.current = true; open(el) }, 450) } }} onPointerUp={() => clearTimeout(timer.current)} onPointerCancel={() => clearTimeout(timer.current)} onPointerLeave={() => clearTimeout(timer.current)}
      onClick={() => { if (!long.current) choose(item.id, index) }}><item.icon size={19} strokeWidth={1.5} />{group.length > 1 && <span className="tool-subtype-mark" />}</button>
  })}</div>{menu && createPortal(<div className="tool-flyout" ref={popup} style={{ left: menu.x, top: menu.y }} role="menu" aria-label="Подтипы инструмента">{groups[menu.group].map(item => <button role="menuitem" key={item.id} className={tool === item.id ? 'selected' : ''} onClick={() => choose(item.id, menu.group)}><item.icon size={17} /><span>{item.name}</span><kbd>{item.key}</kbd>{tool === item.id && <ChevronRight size={12} />}</button>)}</div>, document.body)}</>
}
