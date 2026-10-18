import { ColorDialog } from './components/ColorDialog'
import { ActionsDialog } from './components/ActionsDialog'
import { builtinActions, parseActionSet, runAction, type StudioAction } from './engine/actions'
import { parseAtn } from './engine/atn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, Circle, CircleHelp, Copy, Crop, Download, Eraser, FilePlus2, FolderOpen, Hand, HardDrive, ImagePlus, Keyboard, LoaderCircle, Maximize, Minus, MousePointer2, Paintbrush, PanelRightClose, PanelRightOpen, Pipette, Plus, Redo2, Save, ScanLine, ShieldCheck, Sparkles, Square, SquareDashed, Trash2, Type, Undo2, WandSparkles, X, ZoomIn, ZoomOut } from 'lucide-react'
import { LayerStyleDialog } from './components/LayerStyleDialog'
import { CompatibilityDialog } from './components/CompatibilityDialog'
import type { CompatibilityReport } from './engine/psd'
import { CanvasStage } from './components/CanvasStage'
import { PropertiesPanel } from './components/PropertiesPanel'
import { LayersPanel } from './components/LayersPanel'
import { ExportDialog, HelpDialog, NewDocumentDialog, ReplaceDialog } from './components/Dialogs'
import { Dropdown, type MenuItem } from './components/Dropdown'
import { Field, IconButton, Select } from './components/ui'
import { useEditor } from './hooks/useEditor'
import { demoDocument, localPoint, makeLayer, newDocument, parseProject, uid } from './engine/document'
import { bitmapLayer, downloadBlob, exportCanvas, loadImage, prepareDocument, validateRasterBudget, rasterizeLayer } from './engine/render'
import { loadDocument, saveDocument } from './engine/storage'
import { runPixelOperation } from './engine/processing'
import { MAX_LAYERS, type EditorDocument, type Layer, type Point, type Rect, type Tool, type ToolSettings } from './types'

const tools = [
  { id: 'move', icon: MousePointer2, name: 'Перемещение', key: 'V' },
  { id: 'select', icon: SquareDashed, name: 'Выделение', key: 'M' },
  { id: 'crop', icon: Crop, name: 'Кадрирование', key: 'C' },
  { id: 'brush', icon: Paintbrush, name: 'Кисть', key: 'B', divider: true },
  { id: 'eraser', icon: Eraser, name: 'Ластик', key: 'E' },
  { id: 'wand', icon: WandSparkles, name: 'Волшебный ластик', key: 'W' },
  { id: 'text', icon: Type, name: 'Текст', key: 'T', divider: true },
  { id: 'rectangle', icon: Square, name: 'Прямоугольник', key: 'U' },
  { id: 'ellipse', icon: Circle, name: 'Эллипс', key: 'O' },
  { id: 'eyedropper', icon: Pipette, name: 'Пипетка', key: 'I' },
  { id: 'hand', icon: Hand, name: 'Рука', key: 'H', divider: true },
] as const
const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]')

export default function App() {
  const initial = useMemo(demoDocument, [])
  const editor = useEditor(initial)
  const doc = editor.document
  const { selectedId, setSelectedId } = editor
  const selected = doc.layers.find(l => l.id === selectedId)
  const [tool, setTool] = useState<Tool>('move')
  const [settings, updateSettings] = useState<ToolSettings>({ color: '#b8a8ff', secondaryColor: '#ffffff', brushSize: 30, brushOpacity: 100, tolerance: 20, autoSelect: true, showGuides: true, shapeFill: true })
  const setSettings = useCallback((patch: Partial<ToolSettings>) => updateSettings(s => ({ ...s, ...patch })), [])
  const [zoom, setZoom] = useState<number | null>(null)
  const [effectiveZoom, setEffectiveZoom] = useState(0.5)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [selection, setSelection] = useState<Rect | null>(null)
  const [rulers, setRulers] = useState(true)
  const [inspector, setInspector] = useState(true)
  const [modal, setModal] = useState<'new' | 'export' | 'help' | 'about' | 'styles' | 'actions' | 'color' | null>(null)
  const [actions, setActions] = useState<StudioAction[]>(() => {
    try { const stored = localStorage.getItem('fsh777-actions'); return stored ? parseActionSet(JSON.parse(stored)) : builtinActions } catch { return builtinActions }
  })
  const [clipboardLayer, setClipboardLayer] = useState<Layer | null>(null)
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null)
  const [pendingDocument, setPendingDocument] = useState<EditorDocument | null>(null)
  const [busy, setBusy] = useState<string | null>('Открываем твою студию…')
  const [ready, setReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dropping, setDropping] = useState(false)
  const dragCounter = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const saveVersion = useRef(0)
  const toastMessage = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 5000)
  }, [])
  useEffect(() => { try { localStorage.setItem('fsh777-actions', JSON.stringify({ version: 1, actions })) } catch { /* Manual export remains available. */ } }, [actions])
  const executeAction = (action: StudioAction) => {
    try { const result = runAction(editor.documentRef.current, selectedId, action); editor.change(() => result.document, `Операция: ${action.name}`); setSelectedId(result.selectedId); setModal(null); toastMessage(`Выполнено: ${action.name}. Ctrl+Z — отменить.`) } catch (error) { toastMessage(error instanceof Error ? error.message : 'Ошибка операции') }
  }
  const captureAction = () => {
    if (!selected || actions.length >= 100) return toastMessage('Выбери слой; в наборе может быть до 100 операций')
    const action: StudioAction = { id: uid(), name: `${selected.name} · цвет`, source: 'Мой набор', steps: [{ name: 'Цветокоррекция слоя', enabled: true, command: { type: 'adjust', values: { ...selected.adjustments } } }] }
    setActions(a => [...a, action]); toastMessage('Цветокоррекция сохранена как операция')
  }
  const fitView = useCallback(() => { setZoom(null); setPan({ x: 0, y: 0 }) }, [])
  const openDocument = (next: EditorDocument) => {
    editor.reset(next); setSelectedId(next.layers.find(l => l.kind === 'image')?.id || next.layers.at(-1)?.id || null)
    setSelection(null); setTool('move'); setModal(null); setPendingDocument(null); setCompatibility(null); fitView()
  }
  useEffect(() => {
    let disposed = false
    ;(async () => {
      let restored: EditorDocument | null = null
      try { restored = await loadDocument() } catch { /* A blocked database must not block editing. */ }
      try {
        await Promise.all([document.fonts.load('700 128px Unbounded'), document.fonts.load('500 14px Manrope')])
        await prepareDocument(restored || initial)
      } catch { if (!disposed) toastMessage('Один из ресурсов не загрузился. Можно открыть своё изображение.') }
      if (!disposed) {
        if (restored) { editor.reset(restored); setSelectedId(restored.layers.find(l => l.kind === 'image')?.id || restored.layers.at(-1)?.id || null) }
        setReady(true); setBusy(null)
      }
    })()
    return () => { disposed = true }
    // Only restore once; subsequent changes belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!ready || editor.entries[editor.index]?.document !== doc) return
    const version = ++saveVersion.current
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      saveDocument(doc).then(() => { if (saveVersion.current === version) setSaveStatus('saved') }).catch(() => {
        if (saveVersion.current === version) { setSaveStatus('error'); toastMessage('Автосохранение недоступно. Скачай проект через Ctrl+S.') }
      })
    }, 700)
    return () => clearTimeout(timer)
  }, [doc, ready, editor.entries, editor.index, toastMessage])
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (saveStatus !== 'saved') { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveStatus])
  useEffect(() => { if (selectedId && !doc.layers.some(l => l.id === selectedId)) setSelectedId(null) }, [doc.layers, selectedId])

  const addText = () => {
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const layer = makeLayer({ kind: 'text', name: 'Твоя идея', text: 'Твоя идея', x: doc.width * 0.2, y: doc.height * 0.4, width: doc.width * 0.65, height: 140, fontFamily: 'Manrope', fontSize: 100, fontWeight: 700, color: settings.color })
    editor.change(d => ({ ...d, layers: [...d.layers, layer] }), 'Добавление текста'); setSelectedId(layer.id); setTool('move')
  }
  const addEmpty = () => {
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const buffer = document.createElement('canvas'); buffer.width = doc.width; buffer.height = doc.height
    const layer = bitmapLayer(makeLayer({ kind: 'image', name: 'Пустой слой', width: doc.width, height: doc.height }), buffer)
    try { validateRasterBudget({ ...doc, layers: [...doc.layers, layer] }) } catch (error) { toastMessage(error instanceof Error ? error.message : 'Превышен лимит растров'); return }
    editor.change(d => ({ ...d, layers: [...d.layers, layer] }), 'Новый пустой слой'); setSelectedId(layer.id)
  }
  const duplicate = (id = selectedId || '') => {
    const layer = doc.layers.find(l => l.id === id)
    if (!layer) return
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const copy = { ...layer, id: uid(), name: `${layer.name} — копия`, x: layer.x + 24, y: layer.y + 24, locked: false, adjustments: { ...layer.adjustments } }
    editor.change(d => { const layers = [...d.layers]; layers.splice(layers.findIndex(l => l.id === id) + 1, 0, copy); return { ...d, layers } }, 'Дублирование слоя')
    setSelectedId(copy.id)
  }
  const deleteLayer = (id = selectedId || '') => {
    const layer = doc.layers.find(l => l.id === id)
    if (!layer) return
    if (layer.locked) return toastMessage('Сначала разблокируй слой')
    editor.change(d => ({ ...d, layers: d.layers.filter(l => l.id !== id) }), 'Удаление слоя'); setSelectedId(null)
  }
  const reorder = (id: string, target: string | number) => {
    editor.change(d => {
      const layers = [...d.layers], from = layers.findIndex(l => l.id === id)
      if (from < 0) return d
      const to = typeof target === 'number' ? Math.max(0, Math.min(layers.length - 1, from + target)) : layers.findIndex(l => l.id === target)
      if (to < 0 || from === to) return d
      const [l] = layers.splice(from, 1); layers.splice(to, 0, l); return { ...d, layers }
    }, 'Порядок слоёв')
  }
  const copyLayer = () => {
    if (!selected) return
    setClipboardLayer(structuredClone(selected)); toastMessage('Слой скопирован во внутренний буфер редактора')
  }
  const pasteLayer = () => {
    if (!clipboardLayer) return toastMessage('Скопируй слой в редакторе или вставь изображение из системного буфера')
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const copy = { ...clipboardLayer, id: uid(), name: `${clipboardLayer.name} — вставка`, x: clipboardLayer.x + 24, y: clipboardLayer.y + 24, locked: false }
    try { validateRasterBudget({ ...doc, layers: [...doc.layers, copy] }) } catch (error) { toastMessage(error instanceof Error ? error.message : 'Превышен лимит растров'); return }
    editor.change(d => ({ ...d, layers: [...d.layers, copy] }), 'Вставка слоя'); setSelectedId(copy.id)
  }
  const rasterizeSelected = async () => {
    if (!selected || selected.locked) return
    setBusy('Растрируем содержимое слоя…')
    try { const canvas = await rasterizeLayer(selected); const next = { ...bitmapLayer(selected, canvas), sourceText: undefined, text: undefined }; validateRasterBudget({ ...doc, layers: doc.layers.map(l => l.id === selected.id ? next : l) }); editor.patchLayer(selected.id, next, 'Растрирование слоя') } catch { toastMessage('Не удалось растрировать слой') } finally { setBusy(null) }
  }
  const mergeVisible = async () => {
    if (!doc.layers.some(l => l.visible)) return toastMessage('Нет видимых слоёв')
    setBusy('Объединяем видимые слои…')
    try {
      const canvas = await exportCanvas(doc)
      const layer = bitmapLayer(makeLayer({ kind: 'image', name: 'Объединённые слои', width: doc.width, height: doc.height }), canvas)
      validateRasterBudget({ ...doc, layers: [...doc.layers.filter(l => !l.visible), layer] })
      editor.change(d => ({ ...d, background: 'transparent', layers: [...d.layers.filter(l => !l.visible), layer] }), 'Объединение видимых слоёв'); setSelectedId(layer.id)
    } catch { toastMessage('Не удалось объединить слои') } finally { setBusy(null) }
  }
  const saveProject = async () => {
    try {
      const current = editor.documentRef.current
      const layers = await Promise.all(current.layers.map(async l => {
        if (!l.src?.startsWith('/')) return l
        const image = await loadImage(l.src)
        const buffer = document.createElement('canvas'); buffer.width = image.width; buffer.height = image.height
        buffer.getContext('2d')!.drawImage(image, 0, 0)
        return { ...l, src: buffer.toDataURL('image/webp', 0.95) }
      }))
      downloadBlob(new Blob([JSON.stringify({ ...current, layers })], { type: 'application/json' }), `${current.name.replace(/[\\/:*?"<>|]/g, '_')}.777`)
      toastMessage('Проект .777 готов к скачиванию. Все слои сохранены.')
    } catch { toastMessage('Не удалось сохранить проект. Попробуй ещё раз.') }
  }
  const importFiles = async (files: File[]) => {
    if (!files.length || busy) return
    setBusy('Открываем файлы…')
    try {
      const actionFile = files.find(f => /\.atn$|\.777actions\.json$/i.test(f.name))
      if (actionFile) {
        if (actionFile.size > 8 * 1024 * 1024) throw new Error('Набор операций должен быть меньше 8 МБ')
        const imported = /\.atn$/i.test(actionFile.name) ? parseAtn(await actionFile.arrayBuffer()) : parseActionSet(JSON.parse(await actionFile.text()))
        if (actions.length + imported.length > 100) throw new Error('До 100 операций в наборе. Удали ненужные перед импортом.')
        setActions(a => [...a, ...imported]); setModal('actions'); toastMessage(`Импортировано операций: ${imported.length}. Проверь поддержку шагов.`); return
      }
      const layered = files.find(f => /\.(psd|psb)$/i.test(f.name))
      if (layered) {
        if (layered.size > 80 * 1024 * 1024) throw new Error('PSD/PSB: размер файла до 80 МБ')
        setBusy('Читаем слои PSD/PSB…')
        const { importPsd } = await import('./engine/psd')
        const result = await importPsd(await layered.arrayBuffer(), layered.name)
        await prepareDocument(result.document); setPendingDocument(result.document); setCompatibility(result.report); return
      }
      const project = files.find(f => /\.(777|fsh777)$/i.test(f.name))
      if (project) {
        if (project.size > 50 * 1024 * 1024) throw new Error('Проект должен быть меньше 50 МБ')
        const next = parseProject(JSON.parse(await project.text())); await prepareDocument(next); setPendingDocument(next); return
      }
      const added: Layer[] = []
      for (const file of files.slice(0, 10)) {
        if (doc.layers.length + added.length >= MAX_LAYERS) throw new Error('В проекте может быть до 100 слоёв')
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются PNG, JPEG, WebP, PSD, PSB и проекты .777')
        if (file.size > 25 * 1024 * 1024) throw new Error('Изображение должно быть меньше 25 МБ')
        let src = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
        const image = await loadImage(src)
        let w = image.width, h = image.height
        const downscale = Math.min(1, 4096 / w, 4096 / h)
        if (downscale < 1) {
          const buffer = document.createElement('canvas'); buffer.width = Math.round(w * downscale); buffer.height = Math.round(h * downscale)
          buffer.getContext('2d')!.drawImage(image, 0, 0, buffer.width, buffer.height); src = buffer.toDataURL('image/png'); w = buffer.width; h = buffer.height; await loadImage(src)
        }
        const ratio = Math.min(1, doc.width * 0.9 / w, doc.height * 0.9 / h)
        added.push(makeLayer({ kind: 'image', name: file.name.replace(/\.[^.]+$/, ''), src, width: w * ratio, height: h * ratio, x: (doc.width - w * ratio) / 2, y: (doc.height - h * ratio) / 2 }))
      }
      if (added.length) {
        await prepareDocument({ ...doc, layers: [...doc.layers, ...added] })
        editor.change(d => ({ ...d, layers: [...d.layers, ...added] }), 'Импорт изображения'); setSelectedId(added.at(-1)!.id); setTool('move'); toastMessage(`Добавлено изображений: ${added.length}`)
      }
    } catch (error) { toastMessage(error instanceof Error ? error.message : 'Не удалось открыть файл') }
    finally { setBusy(null) }
  }
  const pixelAction = async (operation: 'background' | 'wand' | 'erase' | 'fill', point?: Point) => {
    if (!selected) return toastMessage('Сначала выбери слой с изображением')
    if (selected.locked) return toastMessage('Сначала разблокируй слой')
    if (operation === 'background' && selected.kind !== 'image') return toastMessage('Удаление фона работает с изображениями')
    if ((operation === 'erase' || operation === 'fill') && !selection) return toastMessage('Сначала выдели область инструментом M')
    const local = point ? localPoint(selected, point) : undefined
    if (local && (local.x < 0 || local.y < 0 || local.x >= selected.width || local.y >= selected.height)) return toastMessage('Кликни внутри выбранного слоя')
    setBusy(operation === 'background' ? 'Убираем фон на твоём устройстве…' : operation === 'fill' ? 'Заполняем цветами окружения…' : 'Обрабатываем выделение…')
    try {
      const buffer = await rasterizeLayer(selected), ctx = buffer.getContext('2d', { willReadFrequently: true })!
      const sx = buffer.width / selected.width, sy = buffer.height / selected.height
      let rect: Rect | undefined
      if (selection && (operation === 'erase' || operation === 'fill')) {
        const points = [localPoint(selected, selection), localPoint(selected, { x: selection.x + selection.width, y: selection.y }), localPoint(selected, { x: selection.x, y: selection.y + selection.height }), localPoint(selected, { x: selection.x + selection.width, y: selection.y + selection.height })]
        const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
        rect = { x: x * sx, y: y * sy, width: (Math.max(...points.map(p => p.x)) - x) * sx, height: (Math.max(...points.map(p => p.y)) - y) * sy }
      }
      const pixels = await runPixelOperation({ operation, width: buffer.width, height: buffer.height, pixels: ctx.getImageData(0, 0, buffer.width, buffer.height).data, tolerance: settings.tolerance, x: local ? local.x * sx : 0, y: local ? local.y * sy : 0, rect })
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), buffer.width, buffer.height), 0, 0)
      const layer = bitmapLayer(selected, buffer)
      validateRasterBudget({ ...doc, layers: doc.layers.map(l => l.id === selected.id ? layer : l) })
      editor.change(d => ({ ...d, background: operation === 'background' ? 'transparent' : d.background, layers: d.layers.map(l => l.id === selected.id ? layer : l) }), operation === 'background' ? 'Удаление фона' : operation === 'fill' ? 'Заливка окружением' : 'Удаление области')
      setSelection(null)
      toastMessage(operation === 'background' ? 'Фон обработан по цвету краёв. Допуск можно изменить. Ctrl+Z — отменить.' : operation === 'fill' ? 'Область заполнена цветами окружения. Для фактур может понадобиться доработка.' : 'Область стёрта. Ctrl+Z — отменить.')
    } catch (error) { toastMessage(error instanceof Error ? error.message : 'Не удалось обработать изображение') }
    finally { setBusy(null) }
  }
  const crop = () => {
    if (!selection || selection.width < 1 || selection.height < 1) return
    const x = Math.round(selection.x), y = Math.round(selection.y), width = Math.max(1, Math.round(selection.width)), height = Math.max(1, Math.round(selection.height))
    editor.change(d => ({ ...d, width, height, layers: d.layers.map(l => ({ ...l, x: l.x - x, y: l.y - y })) }), 'Кадрирование холста')
    setSelection(null); setTool('move'); fitView(); toastMessage(`Холст: ${width} × ${height} px. Слои сохранены.`)
  }
  const extractText = () => {
    if (!selected?.sourceText || selected.locked) return
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const layer = makeLayer({ kind: 'text', name: `${selected.name} · текст`, text: selected.sourceText, x: selected.x, y: selected.y, width: selected.width, height: selected.height, fontFamily: 'Manrope', fontSize: Math.max(12, Math.min(200, selected.height / Math.max(1, selected.sourceText.split('\n').length) / 1.3)), color: settings.color, fontWeight: 500 })
    editor.change(d => ({ ...d, layers: [...d.layers.map(l => l.id === selected.id ? { ...l, visible: false } : l), layer] }), 'Извлечение текста PSD')
    setSelectedId(layer.id); toastMessage('Текст извлечён. Шрифт заменён на Manrope; исходный растр скрыт и сохранён.')
  }
  const fitLayer = () => {
    if (!selected || selected.locked) return
    const ratio = Math.min(doc.width / selected.width, doc.height / selected.height)
    const width = selected.width * ratio, height = selected.height * ratio
    editor.patchLayer(selected.id, { width, height, x: (doc.width - width) / 2, y: (doc.height - height) / 2 }, 'Подгонка слоя под холст')
  }
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (typing(e.target) || busy || modal || pendingDocument) return
      const mod = e.ctrlKey || e.metaKey
      const action = actions.find(a => a.shortcut?.key === e.code && a.shortcut.shift === e.shiftKey && a.shortcut.ctrl === mod)
      if (action) { e.preventDefault(); executeAction(action); return }
      if (mod) {
        switch (e.code) {
          case 'KeyZ': e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); return
          case 'KeyY': e.preventDefault(); editor.redo(); return
          case 'KeyS': e.preventDefault(); if (e.shiftKey) setModal('export'); else void saveProject(); return
          case 'KeyO': e.preventDefault(); input.current?.click(); return
          case 'KeyN': e.preventDefault(); if (e.shiftKey) addEmpty(); else setModal('new'); return
          case 'KeyJ': e.preventDefault(); duplicate(); return
          case 'KeyC': if (selected) { e.preventDefault(); copyLayer() } return
          case 'KeyI': e.preventDefault(); if (selected && !selected.locked) editor.patchLayer(selected.id, { adjustments: { ...selected.adjustments, invert: selected.adjustments.invert ? 0 : 100 } }, 'Инверсия'); return
          case 'KeyU': if (e.shiftKey && selected && !selected.locked) { e.preventDefault(); editor.patchLayer(selected.id, { adjustments: { ...selected.adjustments, saturation: -100 } }, 'Обесцвечивание') } return
          case 'KeyE': if (e.shiftKey) { e.preventDefault(); void mergeVisible() } return
          case 'KeyT': e.preventDefault(); setTool('move'); return
          case 'Digit0': e.preventDefault(); fitView(); return
          case 'Digit1': e.preventDefault(); setZoom(1); setPan({ x: 0, y: 0 }); return
          case 'Equal': e.preventDefault(); setZoom(Math.min(4, effectiveZoom * 1.2)); return
          case 'Minus': e.preventDefault(); setZoom(Math.max(0.05, effectiveZoom / 1.2)); return
          case 'KeyD': e.preventDefault(); setSelection(null); return
        }
        return
      }
      if (e.key === 'Escape') { setSelection(null); setSelectedId(null); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (selection && tool === 'select') void pixelAction('erase'); else deleteLayer(); return }
      if (e.key.startsWith('Arrow') && selected && !selected.locked) {
        e.preventDefault(); const amount = e.shiftKey ? 10 : 1
        editor.patchLayer(selected.id, { x: selected.x + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0), y: selected.y + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0) }, 'Перемещение слоя'); return
      }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') { setSettings({ brushSize: Math.max(1, Math.min(500, settings.brushSize + (e.code === 'BracketLeft' ? -5 : 5))) }); return }
      if (e.code === 'KeyX') { setSettings({ color: settings.secondaryColor, secondaryColor: settings.color }); return }
      if (e.code === 'KeyD') { setSettings({ color: '#000000', secondaryColor: '#ffffff' }); return }
      if (e.key === '?') { setModal('help'); return }
      const match = tools.find(t => `Key${t.key}` === e.code)
      if (match) { e.preventDefault(); setTool(match.id); if (match.id !== 'select' && match.id !== 'crop') setSelection(null) }
    }
    const paste = (e: ClipboardEvent) => { if (typing(e.target) || modal || busy) return; const files = Array.from(e.clipboardData?.files || []); if (files.length) { e.preventDefault(); void importFiles(files) } else if (clipboardLayer) { e.preventDefault(); pasteLayer() } }
    window.addEventListener('keydown', keydown); window.addEventListener('paste', paste)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('paste', paste) }
  })
  const [renamingDoc, setRenamingDoc] = useState(false)
  const closeModal = useCallback(() => setModal(null), [])
  const closeReplace = useCallback(() => setPendingDocument(null), [])
  const activeTool = tools.find(t => t.id === tool)!
  const fileMenu: MenuItem[] = [
    { label: 'Новый проект', icon: FilePlus2, shortcut: 'Ctrl N', action: () => setModal('new') },
    { label: 'Открыть файл…', icon: FolderOpen, shortcut: 'Ctrl O', action: () => input.current?.click() },
    { label: 'Сохранить проект .777', icon: Save, shortcut: 'Ctrl S', action: () => void saveProject(), divider: true },
    { label: 'Экспорт изображения…', icon: Download, shortcut: 'Ctrl ⇧ S', action: () => setModal('export') },
    { label: 'Открыть демопроект', icon: Sparkles, action: () => setPendingDocument(demoDocument()), divider: true },
  ]
  const editMenu: MenuItem[] = [
    { label: 'Отменить', icon: Undo2, shortcut: 'Ctrl Z', action: editor.undo, disabled: !editor.canUndo },
    { label: 'Повторить', icon: Redo2, shortcut: 'Ctrl ⇧ Z', action: editor.redo, disabled: !editor.canRedo },
    { label: 'Копировать слой', icon: Copy, shortcut: 'Ctrl C', action: copyLayer, disabled: !selected, divider: true },
    { label: 'Вставить слой', icon: Copy, shortcut: 'Ctrl V', action: pasteLayer, disabled: !clipboardLayer },
    { label: 'Дублировать слой', icon: Copy, shortcut: 'Ctrl J', action: () => duplicate(), disabled: !selected, divider: true },
    { label: 'Удалить слой', icon: Trash2, shortcut: 'Del', action: () => deleteLayer(), disabled: !selected || selected.locked },
    { label: 'Снять выделение', icon: SquareDashed, shortcut: 'Esc', action: () => setSelection(null), disabled: !selection, divider: true },
  ]
  const viewMenu: MenuItem[] = [
    { label: 'По размеру окна', icon: Maximize, shortcut: 'Ctrl 0', action: fitView },
    { label: 'Масштаб 100%', icon: ScanLine, shortcut: 'Ctrl 1', action: () => { setZoom(1); setPan({ x: 0, y: 0 }) } },
    { label: 'Приблизить', icon: ZoomIn, action: () => setZoom(Math.min(4, effectiveZoom * 1.25)) },
    { label: 'Отдалить', icon: ZoomOut, action: () => setZoom(Math.max(0.05, effectiveZoom / 1.25)) },
    { label: 'Линейки', checked: rulers, action: () => setRulers(!rulers), divider: true },
    { label: 'Умные направляющие', checked: settings.showGuides, action: () => setSettings({ showGuides: !settings.showGuides }) },
    { label: 'Панель свойств и слоёв', checked: inspector, action: () => setInspector(!inspector) },
  ]
  const layerMenu: MenuItem[] = [
    { label: 'Новый пустой слой', icon: Plus, shortcut: 'Ctrl ⇧ N', action: addEmpty },
    { label: 'Новый текст', icon: Type, action: addText },
    { label: 'Стиль слоя…', icon: Sparkles, action: () => setModal('styles'), disabled: !selected || selected.locked, divider: true },
    { label: 'Растрировать содержимое', icon: ImagePlus, action: () => void rasterizeSelected(), disabled: !selected || selected.locked },
    { label: 'Объединить видимые', icon: Copy, shortcut: 'Ctrl ⇧ E', action: () => void mergeVisible(), disabled: !doc.layers.some(l => l.visible), divider: true },
    { label: 'Дублировать', icon: Copy, action: () => duplicate(), disabled: !selected },
    { label: 'Удалить', icon: Trash2, action: () => deleteLayer(), disabled: !selected || selected.locked },
  ]
  const helpMenu: MenuItem[] = [{ label: 'Горячие клавиши', icon: Keyboard, shortcut: '?', action: () => setModal('help') }, { label: 'О ФШ 777', icon: Sparkles, action: () => setModal('about') }]

  return <div className="editor-app" onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragCounter.current++; setDropping(true) } }} onDragLeave={e => { if (e.dataTransfer.types.includes('Files')) { dragCounter.current--; if (dragCounter.current <= 0) setDropping(false) } }} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); dragCounter.current = 0; setDropping(false); void importFiles(Array.from(e.dataTransfer.files)) } }}>
    <header className="app-header">
      <button className="brand" onClick={() => setModal('about')} aria-label="О редакторе ФШ 777"><span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 7h20v5L16 26H7l12-13H7z" fill="currentColor" /></svg></span><span className="brand-name">ФШ <b>777</b></span><span className="beta-badge">BETA</span></button>
      <nav className="main-menu" aria-label="Меню редактора"><Dropdown label="Файл" items={fileMenu} /><Dropdown label="Правка" items={editMenu} /><Dropdown label="Слой" items={layerMenu} /><Dropdown label="Вид" items={viewMenu} /><button className="menu-trigger" onClick={() => setModal('actions')}>Операции</button><Dropdown label="Помощь" items={helpMenu} /></nav>
      <div className={`save-indicator ${saveStatus}`} title="Автосохранение последнего проекта в этом браузере">{saveStatus === 'saving' ? <LoaderCircle size={14} className="spin" /> : <HardDrive size={14} />}<span>{saveStatus === 'saved' ? 'Все изменения сохранены' : saveStatus === 'saving' ? 'Сохраняем на устройстве…' : 'Скачай проект для сохранения'}</span></div>
      <div className="header-actions"><span className="private-badge"><span />Локально. Приватно.</span><button className="export-button" onClick={() => setModal('export')} disabled={!!busy}><Download size={15} />Экспорт<ChevronDown size={13} /></button></div>
    </header>
    <div className="options-bar">
      <div className="history-buttons"><IconButton icon={Undo2} label="Отменить (Ctrl+Z)" disabled={!editor.canUndo || !!busy} onClick={editor.undo} /><IconButton icon={Redo2} label="Повторить (Ctrl+Shift+Z)" disabled={!editor.canRedo || !!busy} onClick={editor.redo} /></div>
      <div className="vertical-divider" /><div className="current-tool"><activeTool.icon size={16} /><span>{activeTool.name}</span></div><div className="vertical-divider" />
      <div className="tool-options">
        {tool === 'move' ? <><label className="checkbox-row"><input type="checkbox" checked={settings.autoSelect} onChange={e => setSettings({ autoSelect: e.target.checked })} />Автовыбор слоя</label><label className="checkbox-row guides-option"><input type="checkbox" checked={settings.showGuides} onChange={e => setSettings({ showGuides: e.target.checked })} />Направляющие</label></> : tool === 'brush' || tool === 'eraser' ? <><Field label="Размер" value={settings.brushSize} min={1} max={500} suffix="px" onChange={brushSize => setSettings({ brushSize })} /><Field label="Непр." value={settings.brushOpacity} min={1} max={100} suffix="%" onChange={brushOpacity => setSettings({ brushOpacity })} /></> : tool === 'wand' ? <><Field label="Допуск" value={settings.tolerance} min={1} max={75} suffix="%" onChange={tolerance => setSettings({ tolerance })} /><span className="tool-instruction">Кликни по области, которую хочешь стереть</span></> : <span className="tool-instruction">{tool === 'text' ? 'Нажми на холст и напиши свою историю' : tool === 'crop' ? 'Выдели область, которую хочешь оставить' : tool === 'select' ? 'Выдели область для стирания или заливки' : tool === 'eyedropper' ? 'Выбери любой цвет на холсте' : tool === 'hand' ? 'Перетаскивай холст. Ctrl + колесо — масштаб' : 'Потяни на холсте. Shift — ровные пропорции'}</span>}
        {['brush', 'rectangle', 'ellipse', 'text'].includes(tool) && <label className="option-color" title="Основной цвет"><input type="color" aria-label="Цвет инструмента" value={settings.color} onChange={e => setSettings({ color: e.target.value })} /><span style={{ background: settings.color }} /></label>}
      </div>
      <div className="options-right"><button className="add-image-button" onClick={() => input.current?.click()} disabled={!!busy}><ImagePlus size={16} /><span>Добавить изображение</span></button><div className="vertical-divider" /><IconButton icon={inspector ? PanelRightClose : PanelRightOpen} label={inspector ? 'Скрыть панели' : 'Показать панели'} onClick={() => setInspector(!inspector)} /></div>
    </div>
    <div className="editor-body">
      <aside className="toolbar" aria-label="Инструменты"><div className="tool-stack">{tools.map(t => <div key={t.id}>{'divider' in t && <div className="tool-divider" />}<button className={`tool-button ${tool === t.id ? 'selected' : ''}`} aria-label={t.name} aria-pressed={tool === t.id} data-tool={t.id} onClick={() => { setTool(t.id); if (t.id !== 'select' && t.id !== 'crop') setSelection(null) }}><t.icon size={20} strokeWidth={1.65} /><span className="tool-tooltip">{t.name}<kbd>{t.key}</kbd></span></button></div>)}</div>
        <div className="toolbar-colors"><button className="swap-colors" title="Поменять цвета (X)" aria-label="Поменять цвета" onClick={() => setSettings({ color: settings.secondaryColor, secondaryColor: settings.color })}><ArrowLeftRight size={11} /></button><label className="secondary-color" style={{ background: settings.secondaryColor }} title="Фоновый цвет"><input type="color" aria-label="Фоновый цвет инструмента" value={settings.secondaryColor} onChange={e => setSettings({ secondaryColor: e.target.value })} /></label><button className="primary-color" style={{ background: settings.color }} title="Основной цвет" aria-label="Выбрать основной цвет" onClick={() => setModal('color')} /></div>
        <div className="toolbar-bottom"><IconButton icon={Keyboard} label="Горячие клавиши" onClick={() => setModal('help')} /><IconButton icon={CircleHelp} label="О редакторе" onClick={() => setModal('about')} /></div>
      </aside>
      <main className="workspace"><div className="document-bar"><div className="document-tab"><span className="document-dot" />{renamingDoc ? <input autoFocus aria-label="Название проекта" value={doc.name} maxLength={80} onChange={e => editor.change(d => ({ ...d, name: e.target.value }), '', true)} onBlur={() => { if (!editor.documentRef.current.name.trim()) editor.change(d => ({ ...d, name: 'Без названия' }), '', true); editor.finish('Название проекта'); setRenamingDoc(false) }} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} /> : <button className="document-name" title="Нажми, чтобы переименовать проект" onClick={() => setRenamingDoc(true)}>{doc.name}<span>.777</span></button>}<span className="document-unsaved">{saveStatus === 'saving' ? '•' : ''}</span></div><IconButton icon={Plus} label="Создать новый проект" onClick={() => setModal('new')} /><div className="document-meta"><span>{doc.width} × {doc.height} px</span><span className="color-profile">RGB / 8</span></div></div>
        <CanvasStage editor={editor} selectedId={selectedId} onSelect={setSelectedId} tool={tool} setTool={setTool} settings={settings} setColor={color => setSettings({ color })} zoom={zoom} setZoom={setZoom} onEffectiveZoom={setEffectiveZoom} pan={pan} setPan={setPan} selection={selection} setSelection={setSelection} onCrop={crop} onPixelAction={(op, point) => void pixelAction(op, point)} onToast={toastMessage} rulers={rulers} busy={!!busy} />
        <footer className="workspace-status"><span className="status-left"><span className="status-dot" />Все инструменты — на твоей стороне<span className="status-divider" />{selected ? selected.name : 'Холст'}</span><div className="zoom-controls"><IconButton icon={Minus} label="Уменьшить масштаб" disabled={effectiveZoom <= 0.05} onClick={() => setZoom(Math.max(0.05, effectiveZoom / 1.25))} /><Select aria-label="Масштаб холста" value={zoom === null ? 'fit' : String(zoom)} onChange={e => { if (e.target.value === 'fit') fitView(); else { setZoom(+e.target.value); setPan({ x: 0, y: 0 }) } }}><option value="fit">{zoom === null ? `${Math.round(effectiveZoom * 100)}%` : 'По размеру окна'}</option>{zoom !== null && ![0.25, 0.5, 0.75, 1, 1.5, 2, 4].includes(zoom) && <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>}{[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map(z => <option key={z} value={String(z)}>{z * 100}%</option>)}</Select><IconButton icon={Plus} label="Увеличить масштаб" disabled={effectiveZoom >= 4} onClick={() => setZoom(Math.min(4, effectiveZoom * 1.25))} /><div className="vertical-divider" /><IconButton icon={Maximize} label="Вписать холст (Ctrl+0)" onClick={fitView} /></div></footer>
      </main>
      {inspector && <aside className="inspector" aria-label="Свойства и слои"><PropertiesPanel editor={editor} layer={selected} onStyle={() => setModal('styles')} onExtractText={extractText} onRemoveBackground={() => void pixelAction('background')} onFitLayer={fitLayer} onImport={() => input.current?.click()} onAddText={addText} settings={settings} setSettings={setSettings} busy={!!busy} /><LayersPanel editor={editor} selectedId={selectedId} onSelect={setSelectedId} onAdd={addEmpty} onDuplicate={duplicate} onDelete={deleteLayer} onReorder={reorder} /><div className="inspector-footer"><ShieldCheck size={12} /><span>Твои файлы остаются у тебя</span><span className="footer-777">777</span></div></aside>}
    </div>
    <input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,.777,.fsh777,.psd,.psb,.atn,.777actions.json" multiple aria-label="Открыть изображение или проект" onChange={e => { void importFiles(Array.from(e.target.files || [])); e.target.value = '' }} />
    {modal === 'new' && <NewDocumentDialog onClose={closeModal} onSave={() => void saveProject()} onCreate={(w, h, name, bg) => openDocument(newDocument(w, h, name, bg))} />}
    {modal === 'export' && <ExportDialog doc={doc} onClose={closeModal} onSave={() => void saveProject()} onToast={toastMessage} />}
    {(modal === 'help' || modal === 'about') && <HelpDialog onClose={closeModal} initialTab={modal === 'about' ? 'about' : 'shortcuts'} />}
    {modal === 'color' && <ColorDialog color={settings.color} onClose={closeModal} onApply={color => { setSettings({ color }); if (selected && !selected.locked && selected.kind !== 'image') editor.patchLayer(selected.id, { color }, 'Цвет слоя'); closeModal() }} />}
    {modal === 'actions' && <ActionsDialog actions={actions} onClose={closeModal} onImport={() => input.current?.click()} onRun={executeAction} onCapture={captureAction} onDelete={id => setActions(a => a.filter(v => v.id !== id))} canRun={!!selected && !selected.locked} />}
    {modal === 'styles' && selected && <LayerStyleDialog layer={selected} onClose={closeModal} onApply={styles => { editor.patchLayer(selected.id, { styles }, 'Стиль слоя'); closeModal() }} />}
    {pendingDocument && compatibility && <CompatibilityDialog report={compatibility} onClose={() => { setPendingDocument(null); setCompatibility(null) }} onSave={() => void saveProject()} onConfirm={() => openDocument(pendingDocument)} />}
    {pendingDocument && !compatibility && <ReplaceDialog name={pendingDocument.name} onClose={closeReplace} onSave={() => void saveProject()} onConfirm={() => openDocument(pendingDocument)} />}
    {busy && <div className="busy-overlay" role="status"><div><LoaderCircle className="spin" size={22} /><span>{busy}</span><small>Никаких загрузок на сервер</small></div></div>}
    {dropping && <div className="drop-overlay"><div><ImagePlus size={40} strokeWidth={1.3} /><h2>Дай идее место на холсте</h2><p>Отпусти изображение или проект .777 здесь</p><span>PNG · JPEG · WebP</span></div></div>}
    {toast && <div className="toast" role="status"><span className="toast-icon"><Check size={14} /></span><span>{toast}</span><button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={14} /></button></div>}
    <div className="small-screen-note"><span className="brand-mark"><Sparkles size={22} /></span><h2>Идеям нужно чуть больше места</h2><p>Открой редактор на компьютере или поверни планшет. Для удобной работы нужен экран от 640 px.</p></div>
  </div>
}
