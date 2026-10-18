import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Circle, Copy, Eye, EyeOff, History, Layers, LockKeyhole, Plus, Square, Trash2, Type, UnlockKeyhole } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { Editor } from '../hooks/useEditor'
import type { BlendMode, Layer } from '../types'
import { Field, IconButton, Select } from './ui'

interface Props {
  editor: Editor
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: () => void
  onDuplicate: (id?: string) => void
  onDelete: (id?: string) => void
  onReorder: (id: string, target: string | number) => void
}
const modes: [BlendMode, string][] = [['source-over', 'Обычный'], ['multiply', 'Умножение'], ['screen', 'Экран'], ['overlay', 'Перекрытие'], ['darken', 'Темнее'], ['lighten', 'Светлее'], ['soft-light', 'Мягкий свет'], ['difference', 'Разница']]
export function LayerThumbnail({ layer }: { layer: Layer }) {
  return <span className={`layer-thumbnail ${layer.kind === 'image' ? 'checkerboard' : ''}`}>{layer.kind === 'image' ? layer.src && <img src={layer.src} alt="" draggable={false} /> : layer.kind === 'text' ? <Type size={18} /> : layer.shape === 'ellipse' ? <Circle size={19} style={{ color: layer.color }} /> : <Square size={19} style={{ color: layer.color }} />}</span>
}
export function LayersPanel({ editor, selectedId, onSelect, onAdd, onDuplicate, onDelete, onReorder }: Props) {
  const [tab, setTab] = useState<'layers' | 'history'>('layers')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const layer = editor.document.layers.find(l => l.id === selectedId)
  const contextual = editor.document.layers.find(l => l.id === context?.id)
  const rename = (l: Layer) => { setRenaming(l.id); setName(l.name); setContext(null) }
  const commitRename = () => {
    if (renaming && name.trim()) editor.patchLayer(renaming, { name: name.trim().slice(0, 100) }, 'Название слоя')
    setRenaming(null)
  }
  useEffect(() => {
    if (!context) return
    const close = (e: PointerEvent) => { if (!contextRef.current?.contains(e.target as Node)) setContext(null) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setContext(null) }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [context])
  return <section className="layers-panel">
    <div className="layers-heading"><div className="panel-tabs"><button className={tab === 'layers' ? 'selected' : ''} onClick={() => setTab('layers')}>Слои<span className="count-badge">{editor.document.layers.length}</span></button><button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>История</button></div><IconButton icon={Plus} label="Добавить пустой слой" onClick={onAdd} /></div>
    {tab === 'layers' ? <>
      <div className="layer-compositing"><Select aria-label="Режим наложения" disabled={!layer || layer.locked} value={layer?.blendMode || 'source-over'} onChange={e => layer && editor.patchLayer(layer.id, { blendMode: e.target.value as BlendMode }, 'Режим наложения')}>{modes.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Select><Field label="Непр." value={Math.round((layer?.opacity ?? 1) * 100)} min={0} max={100} suffix="%" disabled={!layer || layer.locked} onChange={v => layer && editor.patchLayer(layer.id, { opacity: v / 100 }, '', true)} onCommit={() => editor.finish('Непрозрачность')} /></div>
      <div className="layer-list" aria-label="Слои документа">
        {editor.document.layers.length === 0 && <div className="empty-layers"><Layers size={26} strokeWidth={1.3} /><span>Пока чистый лист</span><p>Добавь изображение, текст<br />или нарисуй что-нибудь.</p><button className="text-button" onClick={onAdd}>Создать первый слой</button></div>}
        {[...editor.document.layers].reverse().map(l => <div key={l.id} className={`layer-row ${selectedId === l.id ? 'selected' : ''} ${!l.visible ? 'hidden-layer' : ''} ${dragId === l.id ? 'dragging' : ''} ${dropId === l.id ? 'drop-target' : ''}`} role="option" aria-selected={selectedId === l.id} aria-label={l.name} tabIndex={0}
          draggable={!renaming} onDragStart={e => { e.dataTransfer.setData('application/x-fsh-layer', l.id); e.dataTransfer.effectAllowed = 'move'; setDragId(l.id) }} onDragEnd={() => { setDragId(null); setDropId(null) }}
          onDragOver={e => { if (dragId && dragId !== l.id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropId(l.id) } }}
          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('application/x-fsh-layer'); if (id && id !== l.id) onReorder(id, l.id); setDragId(null); setDropId(null) }}
          onClick={() => onSelect(l.id)} onKeyDown={e => { if (e.key === 'Enter' && !renaming) onSelect(l.id); if (e.key === 'F2') rename(l) }}
          onContextMenu={e => { e.preventDefault(); onSelect(l.id); setContext({ id: l.id, x: Math.min(e.clientX, window.innerWidth - 216), y: Math.min(e.clientY, window.innerHeight - 266) }) }}>
          <button className="layer-visibility" title={l.visible ? `Скрыть: ${l.name}` : `Показать: ${l.name}`} aria-label={l.visible ? `Скрыть: ${l.name}` : `Показать: ${l.name}`} onClick={e => { e.stopPropagation(); editor.patchLayer(l.id, { visible: !l.visible }, l.visible ? 'Скрытие слоя' : 'Показ слоя') }}>{l.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
          <LayerThumbnail layer={l} />
          {renaming === l.id ? <input autoFocus className="layer-rename" aria-label="Название слоя" value={name} maxLength={100} onChange={e => setName(e.target.value)} onClick={e => e.stopPropagation()} onBlur={commitRename} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null) }} /> : <span className="layer-name" onDoubleClick={() => rename(l)} title={l.name}>{l.name}</span>}
          <button className={`layer-lock ${l.locked ? 'locked' : ''}`} aria-label={l.locked ? `Разблокировать: ${l.name}` : `Заблокировать: ${l.name}`} title={l.locked ? 'Разблокировать слой' : 'Заблокировать слой'} onClick={e => { e.stopPropagation(); editor.patchLayer(l.id, { locked: !l.locked }, l.locked ? 'Разблокировка слоя' : 'Блокировка слоя') }}>{l.locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}</button>
        </div>)}
      </div>
      <footer className="layers-footer"><span><Layers size={13} />{editor.document.layers.length} слоёв</span><div><IconButton icon={ArrowUp} label="Поднять слой" disabled={!layer || editor.document.layers.at(-1)?.id === layer.id} onClick={() => layer && onReorder(layer.id, 1)} /><IconButton icon={ArrowDown} label="Опустить слой" disabled={!layer || editor.document.layers[0]?.id === layer.id} onClick={() => layer && onReorder(layer.id, -1)} /><IconButton icon={Copy} label="Дублировать слой (Ctrl+J)" disabled={!layer} onClick={() => onDuplicate()} /><IconButton icon={Trash2} label="Удалить слой (Delete)" disabled={!layer || layer.locked} onClick={() => onDelete()} /></div></footer>
    </> : <div className="history-list"><p className="history-note">Последние 30 действий. Нажми на шаг,<br />чтобы вернуться к нему.</p>{[...editor.entries].map((entry, i) => <button key={`${entry.time}-${i}`} className={`history-entry ${i === editor.index ? 'current' : ''} ${i > editor.index ? 'future' : ''}`} onClick={() => editor.travel(i)}><span className="history-entry-icon">{i === editor.index ? <Check size={13} /> : <History size={13} />}</span><span>{entry.label}</span><span>{new Date(entry.time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></button>)}</div>}
    {context && contextual && createPortal(<div ref={contextRef} className="context-menu" style={{ left: context.x, top: context.y }} role="menu">
      <button onClick={() => rename(contextual)}><Type size={14} />Переименовать<span>F2</span></button>
      <button onClick={() => { onDuplicate(context.id); setContext(null) }}><Copy size={14} />Дублировать<span>Ctrl J</span></button>
      <button onClick={() => { editor.patchLayer(context.id, { locked: !contextual.locked }, 'Блокировка слоя'); setContext(null) }}><LockKeyhole size={14} />{contextual.locked ? 'Разблокировать' : 'Заблокировать'}</button>
      <div className="menu-divider" />
      <button onClick={() => { onReorder(context.id, 1); setContext(null) }}><ArrowUp size={14} />Поднять слой</button>
      <button onClick={() => { onReorder(context.id, -1); setContext(null) }}><ArrowDown size={14} />Опустить слой</button>
      <div className="menu-divider" /><button className="danger" disabled={contextual.locked} onClick={() => { onDelete(context.id); setContext(null) }}><Trash2 size={14} />Удалить<span>Del</span></button>
    </div>, document.body)}
  </section>
}
