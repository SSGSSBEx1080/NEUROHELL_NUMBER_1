import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  ClipboardCopy,
  ClipboardPaste,
  Eraser,
  History,
  Paintbrush,
  SlidersHorizontal,
  Layers,
  LockKeyhole,
  Plus,
  Square,
  SquareDashed,
  SquareStack,
  Trash2,
  Type,
  UnlockKeyhole,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import type { Editor } from '../hooks/useEditor'
import type { BlendMode, Layer, SelectionMode } from '../types'
import { visibleLayerRows } from '../engine/layerOperations'
import {
  copyStyleToClipboard,
  readStyleClipboard,
  readStyleClipboardBlendIf,
  readStyleClipboardKnockout,
} from '../engine/libraries'
import { defaultStyles, hasStyles, styleEffectSummary } from '../engine/styles'
import { synchronizeStylesToGlobalLight } from '../engine/globalLight'
import { isBlendIfActive } from '../engine/blendIf'
import { Field, IconButton, Select } from './ui'
interface Props {
  editor: Editor
  selectedId: string | null
  onSelect: (id: string | null) => void
  onArrange: (ids: string[]) => void
  onLoadSelection: (id: string, mode: SelectionMode) => void
  onCorrection: () => void
  onAdd: () => void
  onDuplicate: (id?: string) => void
  onDelete: (id?: string) => void
  onReorder: (id: string, target: string | number) => void
  onGroup: (ids?: string[]) => void
  onUngroup: (id?: string) => void
  onMask: (id?: string) => void
  onSmart: () => void
  onOpenSmart: (id: string) => void
  onStyle: (id: string) => void
  editingMask: boolean
  onPixels: () => void
}
const modes: [BlendMode, string][] = [
  ['source-over', 'Обычный'],
  ['dissolve', 'Растворение'],
  ['darken', 'Темнее'],
  ['multiply', 'Умножение'],
  ['color-burn', 'Затемнение основы'],
  ['linear-burn', 'Линейное затемнение'],
  ['darker-color', 'Тёмный цвет'],
  ['lighten', 'Светлее'],
  ['screen', 'Экран'],
  ['color-dodge', 'Осветление основы'],
  ['lighter', 'Линейное осветление (сложение)'],
  ['lighter-color', 'Светлый цвет'],
  ['overlay', 'Перекрытие'],
  ['soft-light', 'Мягкий свет'],
  ['hard-light', 'Жёсткий свет'],
  ['vivid-light', 'Яркий свет'],
  ['linear-light', 'Линейный свет'],
  ['pin-light', 'Точечный свет'],
  ['hard-mix', 'Жёсткое смешивание'],
  ['difference', 'Разница'],
  ['exclusion', 'Исключение'],
  ['subtract', 'Вычитание'],
  ['divide', 'Разделение'],
  ['hue', 'Цветовой тон'],
  ['saturation', 'Насыщенность'],
  ['color', 'Цветность'],
  ['luminosity', 'Яркость'],
]
export function LayerThumbnail({ layer }: { layer: Layer }) {
  return (
    <span className={`layer-thumbnail ${layer.kind === 'image' ? 'checkerboard' : ''}`}>
      {layer.kind === 'adjustment' ? (
        <span className="correction-symbol">◐</span>
      ) : layer.kind === 'group' ? (
        <Folder size={19} />
      ) : layer.kind === 'image' ? (
        layer.src && <img src={layer.src} alt="" draggable={false} />
      ) : layer.kind === 'text' ? (
        <Type size={18} />
      ) : layer.shape === 'ellipse' ? (
        <Circle size={19} style={{ color: layer.color }} />
      ) : (
        <Square size={19} style={{ color: layer.color }} />
      )}
      {layer.smart && <SquareStack className="smart-thumbnail-mark" size={11} />}
    </span>
  )
}
export function LayersPanel({
  editor,
  selectedId,
  onSelect,
  onAdd,
  onCorrection,
  onLoadSelection,
  onArrange,
  onDuplicate,
  onDelete,
  onReorder,
  onGroup,
  onUngroup,
  onMask,
  onSmart,
  onOpenSmart,
  onStyle,
  editingMask,
  onPixels,
}: Props) {
  const [tab, setTab] = useState<'layers' | 'history'>('layers'),
    [renaming, setRenaming] = useState<string | null>(null),
    [name, setName] = useState('')
  const [dragId, setDragId] = useState<string | null>(null),
    [dropId, setDropId] = useState<string | null>(null),
    [marked, setMarked] = useState<string[]>([])
  const rangeAnchor = useRef<string | null>(null)
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null),
    contextRef = useRef<HTMLDivElement>(null)
  const layer = editor.document.layers.find((l) => l.id === selectedId),
    contextual = editor.document.layers.find((l) => l.id === context?.id),
    bottomTopLevel = editor.document.layers.find((l) => !l.parentId),
    rows = visibleLayerRows(editor.document)
  const rename = (l: Layer) => {
    setRenaming(l.id)
    setName(l.name)
    setContext(null)
  }
  const commitRename = () => {
    if (renaming && name.trim())
      editor.patchLayer(renaming, { name: name.trim().slice(0, 100) }, 'Название слоя')
    setRenaming(null)
  }
  const group = () => {
    onGroup(marked.length > 1 ? marked : selectedId ? [selectedId] : [])
    setMarked([])
    setContext(null)
  }
  useEffect(() => {
    setMarked([])
    rangeAnchor.current = null
  }, [editor.document.id])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        marked.length > 1 &&
        (e.ctrlKey || e.metaKey) &&
        e.code === 'KeyG' &&
        !e.shiftKey &&
        !(e.target as HTMLElement)?.closest('input,textarea,select,[role=dialog]')
      ) {
        e.preventDefault()
        e.stopImmediatePropagation()
        group()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })
  useEffect(() => {
    if (!context) return
    const close = (e: PointerEvent) => {
      if (!contextRef.current?.contains(e.target as Node)) setContext(null)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setContext(null)
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', escape, true)
    }
  }, [context])
  return (
    <section className="layers-panel">
      <div className="layers-heading">
        <div className="panel-tabs">
          <button className={tab === 'layers' ? 'selected' : ''} onClick={() => setTab('layers')}>
            Слои<span className="count-badge">{editor.document.layers.length}</span>
          </button>
          <button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>
            История
          </button>
        </div>
        <IconButton icon={Plus} label="Добавить пустой слой" onClick={onAdd} />
      </div>
      {tab === 'layers' ? (
        <>
          <div className="layer-compositing">
            <Select
              aria-label="Режим наложения"
              disabled={!layer || layer.locked}
              value={layer?.blendMode || 'source-over'}
              onChange={(e) =>
                layer &&
                editor.patchLayer(
                  layer.id,
                  {
                    blendMode: e.target.value as BlendMode,
                    ...(layer.kind === 'group'
                      ? { isolated: e.target.value !== 'source-over' }
                      : {}),
                  },
                  'Режим наложения',
                )
              }
            >
              {modes.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
            <Field
              label="Непр."
              value={Math.round((layer?.opacity ?? 1) * 100)}
              min={0}
              max={100}
              suffix="%"
              disabled={!layer || layer.locked}
              onChange={(v) => layer && editor.patchLayer(layer.id, { opacity: v / 100 }, '', true)}
              onCommit={() => editor.finish('Непрозрачность')}
            />
            <Field
              label="Заливка"
              value={Math.round((layer?.styles?.fillOpacity ?? 1) * 100)}
              min={0}
              max={100}
              suffix="%"
              disabled={!layer || layer.locked || layer.kind === 'adjustment'}
              onChange={(v) =>
                layer &&
                editor.patchLayer(
                  layer.id,
                  {
                    styles: {
                      ...(layer.styles || defaultStyles()),
                      fillOpacity: v / 100,
                    },
                  },
                  '',
                  true,
                )
              }
              onCommit={() => editor.finish('Заливка слоя')}
            />
          </div>
          {marked.length > 1 && (
            <div className="group-selection-note">
              <span>{marked.length} слоёв выбрано</span>
              <button onClick={() => onArrange(marked)}>Выровнять…</button>
              <button onClick={group}>Группировать · Ctrl G</button>
            </div>
          )}
          <div
            className="layer-list"
            aria-label="Слои документа"
            role="listbox"
            aria-multiselectable="true"
          >
            {!rows.length && (
              <div className="empty-layers">
                <Layers size={26} strokeWidth={1.3} />
                <span>Пока чистый лист</span>
                <p>
                  Добавь изображение, текст
                  <br />
                  или нарисуй что-нибудь.
                </p>
                <button className="text-button" onClick={onAdd}>
                  Создать первый слой
                </button>
              </div>
            )}
            {rows.map(({ layer: l, depth }) => (
              <div
                key={l.id}
                className={`layer-row ${selectedId === l.id ? 'selected' : ''} ${marked.includes(l.id) && marked.length > 1 ? 'group-marked' : ''} ${!l.visible ? 'hidden-layer' : ''} ${dragId === l.id ? 'dragging' : ''} ${dropId === l.id ? 'drop-target' : ''}`}
                style={{ paddingLeft: 8 + Math.min(depth, 5) * 12 }}
                role="option"
                aria-selected={selectedId === l.id || marked.includes(l.id)}
                aria-label={l.name}
                tabIndex={0}
                draggable={!renaming}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-fsh-layer', l.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDragId(l.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDropId(null)
                }}
                onDragOver={(e) => {
                  if (dragId && dragId !== l.id) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDropId(l.id)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('application/x-fsh-layer')
                  if (id && id !== l.id) onReorder(id, l.id)
                  setDragId(null)
                  setDropId(null)
                }}
                onClick={(e) => {
                  if (e.shiftKey) {
                    const start = rows.findIndex(
                        (r) => r.layer.id === (rangeAnchor.current || selectedId),
                      ),
                      end = rows.findIndex((r) => r.layer.id === l.id)
                    const range = rows
                      .slice(Math.min(start < 0 ? end : start, end), Math.max(start, end) + 1)
                      .map((r) => r.layer.id)
                    setMarked((previous) =>
                      e.ctrlKey || e.metaKey ? [...new Set([...previous, ...range])] : range,
                    )
                  } else if (e.ctrlKey || e.metaKey) {
                    rangeAnchor.current = l.id
                    setMarked((ids) => {
                      const before = ids.length ? ids : selectedId ? [selectedId] : []
                      return before.includes(l.id)
                        ? before.filter((id) => id !== l.id)
                        : [...before, l.id]
                    })
                  } else {
                    setMarked([])
                    rangeAnchor.current = l.id
                  }
                  onSelect(l.id)
                  onPixels()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !renaming) onSelect(l.id)
                  if (e.key === 'F2') rename(l)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onSelect(l.id)
                  if (!marked.includes(l.id)) setMarked([])
                  setContext({
                    id: l.id,
                    x: Math.min(e.clientX, window.innerWidth - 260),
                    y: Math.max(8, Math.min(e.clientY, window.innerHeight - 425)),
                  })
                }}
              >
                <button
                  className="layer-visibility"
                  aria-label={l.visible ? `Скрыть: ${l.name}` : `Показать: ${l.name}`}
                  title={l.visible ? 'Скрыть слой' : 'Показать слой'}
                  onClick={(e) => {
                    e.stopPropagation()
                    editor.patchLayer(
                      l.id,
                      { visible: !l.visible },
                      l.visible ? 'Скрытие слоя' : 'Показ слоя',
                    )
                  }}
                >
                  {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                {l.kind === 'group' && (
                  <button
                    className="group-toggle"
                    aria-label={
                      l.expanded === false
                        ? `Раскрыть группу: ${l.name}`
                        : `Свернуть группу: ${l.name}`
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      editor.patchLayer(
                        l.id,
                        { expanded: l.expanded === false },
                        'Состояние группы',
                      )
                    }}
                  >
                    {l.expanded === false ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                )}
                <button
                  className="layer-pixels-button"
                  aria-label={l.smart ? `Открыть содержимое: ${l.name}` : `Пиксели слоя: ${l.name}`}
                  title="Ctrl+клик — выделить непрозрачность; Shift добавляет, Alt вычитает"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (e.ctrlKey || e.metaKey) {
                      onLoadSelection(
                        l.id,
                        e.altKey
                          ? e.shiftKey
                            ? 'intersect'
                            : 'subtract'
                          : e.shiftKey
                            ? 'add'
                            : 'replace',
                      )
                      return
                    }
                    onSelect(l.id)
                    onPixels()
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (l.smart) onOpenSmart(l.id)
                  }}
                >
                  <LayerThumbnail layer={l} />
                </button>
                {l.mask && (
                  <button
                    className={`layer-mask-thumbnail ${editingMask && selectedId === l.id ? 'selected' : ''} ${!l.mask.enabled ? 'disabled-mask' : ''}`}
                    aria-label={`Редактировать маску: ${l.name}`}
                    title="Клик — рисовать по маске. Shift+клик — включить / выключить"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (e.shiftKey)
                        editor.patchLayer(
                          l.id,
                          { mask: { ...l.mask!, enabled: !l.mask!.enabled } },
                          'Включение маски',
                        )
                      else {
                        onSelect(l.id)
                        onMask(l.id)
                      }
                    }}
                  >
                    {!l.mask.src.startsWith('mask-preview:') && <img src={l.mask.src} alt="" />}
                  </button>
                )}
                {renaming === l.id ? (
                  <input
                    autoFocus
                    className="layer-rename"
                    aria-label="Название слоя"
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <span
                    className={`layer-name ${l.background ? 'background-layer' : ''}`}
                    onDoubleClick={() => rename(l)}
                    title={l.background ? `${l.name} · Background (стопор Deep Knockout)` : l.name}
                  >
                    {l.name}
                  </span>
                )}
                {(hasStyles(l.styles) || isBlendIfActive(l.blendIf) || l.knockout) && (
                  <button
                    className="layer-fx-mark"
                    aria-label={`Стиль слоя: ${l.name}`}
                    title={
                      [
                        styleEffectSummary(l.styles),
                        isBlendIfActive(l.blendIf) ? 'Blend If' : '',
                        l.knockout
                          ? `Knockout: ${l.knockout === 'deep' ? 'глубокое' : 'мелкое'}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Эффекты слоя'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(l.id)
                      onStyle(l.id)
                    }}
                  >
                    fx
                  </button>
                )}
                <button
                  className={`layer-lock ${l.locked ? 'locked' : ''}`}
                  aria-label={l.locked ? `Разблокировать: ${l.name}` : `Заблокировать: ${l.name}`}
                  title={l.locked ? 'Разблокировать слой' : 'Заблокировать слой'}
                  onClick={(e) => {
                    e.stopPropagation()
                    editor.patchLayer(
                      l.id,
                      { locked: !l.locked },
                      l.locked ? 'Разблокировка слоя' : 'Блокировка слоя',
                    )
                  }}
                >
                  {l.locked ? <LockKeyhole size={12} /> : <UnlockKeyhole size={12} />}
                </button>
              </div>
            ))}
          </div>
          <footer className="layers-footer">
            <span>{editor.document.layers.length} слоёв</span>
            <div>
              <IconButton
                icon={SlidersHorizontal}
                label="Новый корректирующий слой"
                onClick={onCorrection}
              />
              <IconButton icon={FolderPlus} label="Группировать слои (Ctrl+G)" onClick={group} />
              <IconButton
                icon={SquareDashed}
                label="Добавить маску слоя"
                disabled={!layer || layer.locked || !!layer.mask}
                onClick={() => onMask()}
              />
              <IconButton
                icon={ArrowUp}
                label="Поднять слой"
                disabled={!layer}
                onClick={() => layer && onReorder(layer.id, 1)}
              />
              <IconButton
                icon={ArrowDown}
                label="Опустить слой"
                disabled={!layer}
                onClick={() => layer && onReorder(layer.id, -1)}
              />
              <IconButton
                icon={Copy}
                label="Дублировать слой (Ctrl+J)"
                disabled={!layer}
                onClick={() => onDuplicate()}
              />
              <IconButton
                icon={Trash2}
                label="Удалить слой (Delete)"
                disabled={!layer || layer.locked}
                onClick={() => onDelete()}
              />
            </div>
          </footer>
        </>
      ) : (
        <div className="history-list">
          <p className="history-note">
            История текущей вкладки · {editor.entries.length - 1} действий.
            <br />
            Нажми на шаг, чтобы вернуться к нему.
          </p>
          {editor.entries.map((entry, i) => (
            <button
              key={`${entry.time}-${i}`}
              className={`history-entry ${i === editor.index ? 'current' : ''} ${i > editor.index ? 'future' : ''}`}
              onClick={() => editor.travel(i)}
            >
              <span className="history-entry-icon">
                {i === editor.index ? <Check size={13} /> : <History size={13} />}
              </span>
              <span>{entry.label}</span>
              <span>
                {new Date(entry.time).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </button>
          ))}
        </div>
      )}
      {context &&
        contextual &&
        createPortal(
          <div
            ref={contextRef}
            className="context-menu"
            style={{ left: context.x, top: context.y }}
            role="menu"
          >
            <button onClick={() => rename(contextual)}>
              <Type size={14} />
              Переименовать<span>F2</span>
            </button>
            <button
              onClick={() => {
                onDuplicate(context.id)
                setContext(null)
              }}
            >
              <Copy size={14} />
              Дублировать<span>Ctrl J</span>
            </button>
            <button
              onClick={() => {
                onArrange(marked.length > 1 ? marked : [context.id])
                setContext(null)
              }}
            >
              Выравнивание и интервалы…
            </button>
            <button onClick={group}>
              <FolderPlus size={14} />
              Группировать<span>Ctrl G</span>
            </button>
            {contextual.kind === 'group' && (
              <button
                onClick={() => {
                  onUngroup(context.id)
                  setContext(null)
                }}
              >
                <Folder size={14} />
                Разгруппировать
              </button>
            )}
            <div className="menu-divider" />
            <button
              disabled={contextual.locked || contextual.kind === 'adjustment'}
              onClick={() => {
                onSelect(context.id)
                onStyle(context.id)
                setContext(null)
              }}
            >
              <Paintbrush size={14} />
              Стиль слоя…
            </button>
            <button
              disabled={
                !hasStyles(contextual.styles) &&
                !isBlendIfActive(contextual.blendIf) &&
                !contextual.knockout
              }
              onClick={() => {
                copyStyleToClipboard(
                  contextual.styles || defaultStyles(),
                  contextual.blendIf,
                  contextual.knockout,
                )
                setContext(null)
              }}
            >
              <ClipboardCopy size={14} />
              Копировать стиль
            </button>
            <button
              disabled={
                contextual.locked || contextual.kind === 'adjustment' || !readStyleClipboard()
              }
              onClick={() => {
                const pasted = readStyleClipboard()
                if (pasted)
                  editor.patchLayer(
                    context.id,
                    {
                      styles: editor.document.globalLight
                        ? synchronizeStylesToGlobalLight(pasted, editor.document.globalLight)
                        : pasted,
                      blendIf: readStyleClipboardBlendIf(),
                      knockout: contextual.background ? undefined : readStyleClipboardKnockout(),
                    },
                    'Вставка стиля слоя',
                  )
                setContext(null)
              }}
            >
              <ClipboardPaste size={14} />
              Вставить стиль
            </button>
            <button
              disabled={
                contextual.locked ||
                (!hasStyles(contextual.styles) &&
                  !isBlendIfActive(contextual.blendIf) &&
                  !contextual.knockout)
              }
              onClick={() => {
                editor.patchLayer(
                  context.id,
                  { styles: undefined, blendIf: undefined, knockout: undefined },
                  'Очистка стиля слоя',
                )
                setContext(null)
              }}
            >
              <Eraser size={14} />
              Очистить стиль
            </button>
            {contextual.background ? (
              <button
                disabled={contextual.locked}
                onClick={() => {
                  editor.patchLayer(
                    context.id,
                    { background: undefined },
                    'Background в обычный слой',
                  )
                  setContext(null)
                }}
              >
                <Layers size={14} />
                Background → обычный слой
              </button>
            ) : contextual === bottomTopLevel &&
              contextual.kind === 'image' &&
              !contextual.smart &&
              !contextual.mask ? (
              <button
                disabled={contextual.locked}
                onClick={() => {
                  editor.change(
                    (d) => ({
                      ...d,
                      // Do not silently change pixels outside/through a
                      // semi-transparent bottom layer by deleting the canvas
                      // colour. PSD export warns when both are present.
                      layers: d.layers.map((l) =>
                        l.id === context.id
                          ? {
                              ...l,
                              background: true,
                              knockout: undefined,
                              blendMode: 'source-over',
                              opacity: 1,
                              clipping: false,
                            }
                          : { ...l, background: undefined },
                      ),
                    }),
                    'Background-слой',
                  )
                  setContext(null)
                }}
              >
                <Layers size={14} />
                Сделать Background (стопор Deep)
              </button>
            ) : null}
            <div className="menu-divider" />
            <button
              disabled={contextual.locked}
              onClick={() => {
                onMask(context.id)
                setContext(null)
              }}
            >
              <SquareDashed size={14} />
              {contextual.mask ? 'Редактировать маску' : 'Добавить маску'}
            </button>
            <button
              disabled={contextual.locked || !!contextual.smart || contextual.kind === 'adjustment'}
              onClick={() => {
                onSmart()
                setContext(null)
              }}
            >
              <SquareStack size={14} />
              Создать смарт-объект
            </button>
            {contextual.smart && (
              <button
                onClick={() => {
                  onOpenSmart(context.id)
                  setContext(null)
                }}
              >
                <SquareStack size={14} />
                Открыть содержимое
              </button>
            )}
            <button
              onClick={() => {
                editor.patchLayer(context.id, { locked: !contextual.locked }, 'Блокировка слоя')
                setContext(null)
              }}
            >
              <LockKeyhole size={14} />
              {contextual.locked ? 'Разблокировать' : 'Заблокировать'}
            </button>
            <div className="menu-divider" />
            <button
              onClick={() => {
                onReorder(context.id, 1)
                setContext(null)
              }}
            >
              <ArrowUp size={14} />
              Поднять слой
            </button>
            <button
              onClick={() => {
                onReorder(context.id, -1)
                setContext(null)
              }}
            >
              <ArrowDown size={14} />
              Опустить слой
            </button>
            <div className="menu-divider" />
            <button
              className="danger"
              disabled={contextual.locked}
              onClick={() => {
                onDelete(context.id)
                setContext(null)
              }}
            >
              <Trash2 size={14} />
              Удалить<span>Del</span>
            </button>
          </div>,
          document.body,
        )}
    </section>
  )
}
