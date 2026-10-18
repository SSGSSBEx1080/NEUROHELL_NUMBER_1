import { useEasterEggs } from './hooks/useEasterEggs'
import { HomeScreen } from './components/HomeScreen'
import { ImageSizeDialog } from './components/ImageSizeDialog'
import { CloseDocumentDialog } from './components/CloseDocumentDialog'
import { useWorkspace } from './hooks/useWorkspace'
import {
  groupLayers,
  ungroupLayers,
  duplicateLayers,
  deleteLayers,
  moveLayer,
  subtree,
} from './engine/layerOperations'
import { makeSmartObject } from './engine/smartObjects'
import { Home, FolderPlus, Layers3, SquareStack, RectangleHorizontal } from 'lucide-react'
import { FontsDialog } from './components/FontsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { loadSystemFonts, restoreFonts } from './engine/fonts'
import { ToolRail, TOOLS as tools, cycleTool, selectionTools } from './components/ToolRail'
import { selectionMask } from './engine/selection'
import { loadPreferences, savePreferences } from './engine/preferences'
import { FileManager } from './engine/fileManager'
import { ColorDialog } from './components/ColorDialog'
import { ActionsDialog } from './components/ActionsDialog'
import { builtinActions, parseActionSet, runAction, type StudioAction } from './engine/actions'
import { parseAtn } from './engine/atn'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  HardDrive,
  ImagePlus,
  Keyboard,
  LoaderCircle,
  Maximize,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Save,
  ScanLine,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
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
import {
  demoDocument,
  isLayerLocked,
  localPoint,
  makeLayer,
  newDocument,
  parseProject,
  uid,
} from './engine/document'
import {
  encodeBitmap,
  bitmapLayer,
  downloadBlob,
  exportCanvas,
  loadImage,
  prepareDocument,
  validateRasterBudget,
  rasterizeLayer,
} from './engine/render'
import { saveDocument, hasPendingWrites } from './engine/storage'
import { runPixelOperation } from './engine/processing'
import {
  MAX_LAYERS,
  type EditorDocument,
  type Layer,
  type Point,
  type Selection,
  type Tool,
  type ToolSettings,
  DEFAULT_ADJUSTMENTS,
} from './types'

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[contenteditable="true"]')

export default function App() {
  const initial = useMemo(demoDocument, [])
  const editor = useEditor(initial)
  const doc = editor.document
  const { selectedId, setSelectedId } = editor
  const selectedLayer = doc.layers.find((l) => l.id === selectedId)
  const selected = selectedLayer
    ? { ...selectedLayer, locked: isLayerLocked(doc, selectedLayer.id) }
    : undefined
  const [tool, setTool] = useState<Tool>('move')
  const [settings, updateSettings] = useState<ToolSettings>({
    color: '#b8a8ff',
    secondaryColor: '#ffffff',
    brushSize: 30,
    brushOpacity: 100,
    tolerance: 20,
    autoSelect: true,
    showGuides: true,
    shapeFill: true,
  })
  const setSettings = useCallback(
    (patch: Partial<ToolSettings>) => updateSettings((s) => ({ ...s, ...patch })),
    [],
  )
  const [zoom, setZoom] = useState<number | null>(null)
  const [effectiveZoom, setEffectiveZoom] = useState(0.5)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [preferences, setPreferences] = useState(loadPreferences)
  useEffect(() => {
    savePreferences(preferences)
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full'
    document.documentElement.style.setProperty('--checker-size', `${preferences.checker}px`)
  }, [preferences])
  const [rulers, setRulers] = useState(true)
  const [inspector, setInspector] = useState(true)
  const [modal, setModal] = useState<
    | 'new'
    | 'export'
    | 'help'
    | 'about'
    | 'styles'
    | 'actions'
    | 'color'
    | 'settings'
    | 'fonts'
    | 'image-size'
    | 'canvas-size'
    | null
  >(null)
  const [actions, setActions] = useState<StudioAction[]>(() => {
    try {
      const stored = localStorage.getItem('fsh777-actions')
      return stored ? parseActionSet(JSON.parse(stored)) : builtinActions
    } catch {
      return builtinActions
    }
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
  useEffect(() => {
    try {
      localStorage.setItem('fsh777-actions', JSON.stringify({ version: 1, actions }))
    } catch {
      /* Manual export remains available. */
    }
  }, [actions])
  const executeAction = (action: StudioAction) => {
    try {
      const result = runAction(editor.documentRef.current, selectedId, action)
      editor.change(() => result.document, `Операция: ${action.name}`)
      setSelectedId(result.selectedId)
      setModal(null)
      toastMessage(`Выполнено: ${action.name}. Ctrl+Z — отменить.`)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Ошибка операции')
    }
  }
  const captureAction = () => {
    if (!selected || actions.length >= 100)
      return toastMessage('Выбери слой; в наборе может быть до 100 операций')
    const action: StudioAction = {
      id: uid(),
      name: `${selected.name} · цвет`,
      source: 'Мой набор',
      steps: [
        {
          name: 'Цветокоррекция слоя',
          enabled: true,
          command: { type: 'adjust', values: { ...selected.adjustments } },
        },
      ],
    }
    setActions((a) => [...a, action])
    toastMessage('Цветокоррекция сохранена как операция')
  }
  useEffect(
    () =>
      window.fsh777?.onDownloadStatus(({ state, name }) => {
        toastMessage(
          state === 'completed'
            ? `Файл сохранён: ${name}`
            : state === 'cancelled'
              ? 'Сохранение отменено'
              : 'Не удалось записать файл. Проверь свободное место и права доступа.',
        )
      }),
    [toastMessage],
  )
  const fitView = useCallback(() => {
    setZoom(null)
    setPan({ x: 0, y: 0 })
  }, [])
  const resetView = () => {
    setSelection(null)
    setTool('move')
    setSettings({ editMask: false })
    fitView()
  }
  const workspace = useWorkspace(editor, setBusy, toastMessage, resetView)
  useEasterEggs(workspace.home, () => {
    setPreferences((p) => ({ ...p, theme: p.theme === 'aurora' ? 'violet' : 'aurora' }))
    toastMessage(
      '777 · Секретная палитра найдена. Твои пиксели не изменились. Обычную тему можно вернуть в настройках.',
    )
  })
  const openDocument = (next: EditorDocument) => {
    // Imported IDs are data, not permission to reuse a former tab's native save path.
    // Recovery uses workspace.openRecent instead and intentionally keeps its session ID.
    if (workspace.open({ ...next, id: uid() })) {
      setModal(null)
      setPendingDocument(null)
      setCompatibility(null)
    }
  }

  useEffect(() => {
    let disposed = false
    ;(async () => {
      await workspace.initialize()
      try {
        await restoreFonts()
        if (window.fsh777?.listFonts) void loadSystemFonts().catch(() => {})
        await Promise.all([
          document.fonts.load('700 128px Unbounded'),
          document.fonts.load('500 14px Manrope'),
        ])
      } catch {
        if (!disposed)
          toastMessage('Один из ресурсов не загрузился. Можно открыть своё изображение.')
      }
      if (!disposed) {
        setReady(true)
        setBusy(null)
      }
    })()
    return () => {
      disposed = true
    }
    // Only restore once; subsequent changes belong to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!ready || workspace.home || editor.entries[editor.index]?.document !== doc) return
    const version = ++saveVersion.current
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      saveDocument(doc)
        .then(() => {
          if (saveVersion.current === version) setSaveStatus('saved')
        })
        .catch(() => {
          if (saveVersion.current === version) {
            setSaveStatus('error')
            toastMessage('Автосохранение недоступно. Скачай проект через Ctrl+S.')
          }
        })
    }, preferences.autosave)
    return () => clearTimeout(timer)
  }, [doc, ready, editor.entries, editor.index, toastMessage, preferences.autosave, workspace.home])
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if ((!workspace.home && saveStatus !== 'saved') || hasPendingWrites()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saveStatus, workspace.home])
  useEffect(() => {
    if (selected?.kind === 'text') setInspector(true)
  }, [selectedId, selected?.kind])
  useEffect(() => {
    if (selectedId && !doc.layers.some((l) => l.id === selectedId)) setSelectedId(null)
  }, [doc.layers, selectedId])

  const addText = () => {
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const layer = makeLayer({
      kind: 'text',
      name: 'Твоя идея',
      text: 'Твоя идея',
      x: doc.width * 0.2,
      y: doc.height * 0.4,
      width: doc.width * 0.65,
      height: 140,
      fontFamily: 'Manrope',
      fontSize: 100,
      fontWeight: 700,
      color: settings.color,
    })
    editor.change((d) => ({ ...d, layers: [...d.layers, layer] }), 'Добавление текста')
    setSelectedId(layer.id)
    setTool('move')
  }
  const addEmpty = () => {
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const buffer = document.createElement('canvas')
    buffer.width = doc.width
    buffer.height = doc.height
    const layer = bitmapLayer(
      makeLayer({ kind: 'image', name: 'Пустой слой', width: doc.width, height: doc.height }),
      buffer,
    )
    try {
      validateRasterBudget({ ...doc, layers: [...doc.layers, layer] })
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Превышен лимит растров')
      return
    }
    editor.change((d) => ({ ...d, layers: [...d.layers, layer] }), 'Новый пустой слой')
    setSelectedId(layer.id)
  }
  const duplicate = (id = selectedId || '') => {
    if (!id) return
    try {
      const result = duplicateLayers(editor.documentRef.current, id)
      editor.change(() => result.document, 'Дублирование слоя')
      setSelectedId(result.selectedId)
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Ошибка копирования')
    }
  }
  const deleteLayer = (id = selectedId || '') => {
    editor.change((d) => deleteLayers(d, id), 'Удаление слоя')
    if (!editor.documentRef.current.layers.some((l) => l.id === selectedId)) setSelectedId(null)
  }
  const reorder = (id: string, target: string | number) => {
    try {
      editor.change((d) => moveLayer(d, id, target), 'Порядок слоёв')
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Ошибка порядка слоёв')
    }
  }
  const group = (ids = selectedId ? [selectedId] : []) => {
    try {
      const result = groupLayers(editor.documentRef.current, ids)
      editor.change(() => result.document, 'Группировка слоёв')
      setSelectedId(result.selectedId)
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Не удалось создать группу')
    }
  }
  const ungroup = (id = selectedId || '') => {
    try {
      editor.change((d) => ungroupLayers(d, id), 'Разгруппировка')
      setSelectedId(null)
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Не удалось разгруппировать')
    }
  }
  const convertSmart = async () => {
    if (!selectedId) return
    setBusy('Создаём смарт-объект…')
    try {
      const next = await makeSmartObject(editor.documentRef.current, selectedId)
      editor.change(() => next, 'Создание смарт-объекта')
      toastMessage('Смарт-объект создан. Двойной клик по миниатюре открывает исходное содержимое.')
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Ошибка смарт-объекта')
    } finally {
      setBusy(null)
    }
  }
  const addMask = async (id = selectedId || '') => {
    const layer = editor.documentRef.current.layers.find((l) => l.id === id)
    if (!layer || isLayerLocked(editor.documentRef.current, layer.id)) return
    if (layer.mask) {
      setSelectedId(id)
      setSettings({ editMask: true, color: '#000000', secondaryColor: '#ffffff' })
      setTool('brush')
      return
    }
    setBusy('Создаём маску слоя…')
    try {
      const source = selection
        ? selectionMask(
            selection,
            Math.max(1, Math.min(4096, Math.round(layer.width))),
            Math.max(1, Math.min(4096, Math.round(layer.height))),
            layer,
          )
        : document.createElement('canvas')
      if (!selection) {
        source.width = Math.max(1, Math.min(4096, Math.round(layer.width)))
        source.height = Math.max(1, Math.min(4096, Math.round(layer.height)))
        source.getContext('2d')!.fillStyle = '#ffffff'
        source.getContext('2d')!.fillRect(0, 0, source.width, source.height)
      }
      const ctx = source.getContext('2d')!,
        pixels = ctx.getImageData(0, 0, source.width, source.height)
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = pixels.data[i + 3]
        pixels.data[i + 3] = 255
      }
      ctx.putImageData(pixels, 0, 0)
      const bitmap = await encodeBitmap(layer, source)
      editor.patchLayer(
        id,
        {
          mask: {
            src: bitmap.src!,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            enabled: true,
            linked: true,
            density: 1,
            feather: 0,
            defaultColor: 0,
          },
        },
        'Добавление маски',
      )
      setSelectedId(id)
      setSettings({ editMask: true, color: '#000000', secondaryColor: '#ffffff' })
      setTool('brush')
      setSelection(null)
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Не удалось создать маску')
    } finally {
      setBusy(null)
    }
  }
  const imageSize = (width: number, height: number, dpi: number, centered: boolean) => {
    const scale = modal === 'image-size',
      sx = width / doc.width,
      sy = height / doc.height,
      dx = centered ? (width - doc.width) / 2 : 0,
      dy = centered ? (height - doc.height) / 2 : 0
    if (scale && Math.abs(sx - sy) > 0.00001 && doc.layers.some((l) => l.rotation || l.warp)) {
      toastMessage(
        'Для повёрнутых / перспективных слоёв используй пропорциональный масштаб. Неравномерное изменение исказило бы геометрию.',
      )
      return
    }
    editor.change(
      (d) => ({
        ...d,
        width,
        height,
        dpi,
        layers: d.layers.map((l) => ({
          ...l,
          x: scale ? l.x * sx : l.x + dx,
          y: scale ? l.y * sy : l.y + dy,
          width: scale ? l.width * sx : l.width,
          height: scale ? l.height * sy : l.height,
          fontSize: l.fontSize && scale ? l.fontSize * sy : l.fontSize,
          textScaleX: scale && l.kind === 'text' ? ((l.textScaleX || 1) * sx) / sy : l.textScaleX,
          letterSpacing: l.letterSpacing && scale ? l.letterSpacing * sy : l.letterSpacing,
          mask: l.mask
            ? {
                ...l.mask,
                x: scale ? l.mask.x * sx : l.mask.x + dx,
                y: scale ? l.mask.y * sy : l.mask.y + dy,
                width: scale ? l.mask.width * sx : l.mask.width,
                height: scale ? l.mask.height * sy : l.mask.height,
                feather: scale ? l.mask.feather * sy : l.mask.feather,
              }
            : undefined,
        })),
      }),
      scale ? 'Размер изображения' : 'Размер холста',
    )
    setModal(null)
    setSelection(null)
    fitView()
  }
  const copyLayer = () => {
    if (!selected) return
    if (selected.kind === 'group')
      return toastMessage(
        'Копирование группы: используй Ctrl+J или Alt+перетаскивание. Буфер поддерживает отдельные слои.',
      )
    setClipboardLayer(structuredClone(selected))
    toastMessage('Слой скопирован во внутренний буфер редактора')
  }
  const pasteLayer = () => {
    if (!clipboardLayer)
      return toastMessage('Скопируй слой в редакторе или вставь изображение из системного буфера')
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const copy = {
      ...clipboardLayer,
      id: uid(),
      name: `${clipboardLayer.name} — вставка`,
      x: clipboardLayer.x + 24,
      y: clipboardLayer.y + 24,
      locked: false,
      parentId: undefined,
      sourcePath: undefined,
      mask: clipboardLayer.mask
        ? { ...clipboardLayer.mask, x: clipboardLayer.mask.x + 24, y: clipboardLayer.mask.y + 24 }
        : undefined,
    }
    try {
      validateRasterBudget({ ...doc, layers: [...doc.layers, copy] })
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Превышен лимит растров')
      return
    }
    editor.change((d) => ({ ...d, layers: [...d.layers, copy] }), 'Вставка слоя')
    setSelectedId(copy.id)
  }
  const rasterizeSelected = async () => {
    if (!selected || selected.locked) return
    setBusy('Растрируем содержимое слоя…')
    try {
      const ids = subtree(doc, selected.id)
      const canvas =
        selected.kind === 'group'
          ? await exportCanvas({
              ...doc,
              background: 'transparent',
              layers: doc.layers
                .filter((l) => ids.has(l.id))
                .map((l) =>
                  l.id === selected.id ? { ...l, parentId: undefined, visible: true } : l,
                ),
            })
          : await rasterizeLayer(selected)
      const next =
        selected.kind === 'group'
          ? bitmapLayer(
              makeLayer({
                id: selected.id,
                name: selected.name,
                kind: 'image',
                width: doc.width,
                height: doc.height,
                parentId: selected.parentId,
              }),
              canvas,
            )
          : {
              ...bitmapLayer(selected, canvas),
              sourceText: undefined,
              text: undefined,
              smart: undefined,
            }
      validateRasterBudget({
        ...doc,
        layers: doc.layers.map((l) => (l.id === selected.id ? next : l)),
      })
      editor.change(
        (d) => ({
          ...d,
          layers: d.layers
            .filter((l) => l.id === selected.id || !ids.has(l.id))
            .map((l) => (l.id === selected.id ? next : l)),
        }),
        'Растрирование слоя',
      )
    } catch {
      toastMessage('Не удалось растрировать слой')
    } finally {
      setBusy(null)
    }
  }
  const mergeVisible = async () => {
    if (!doc.layers.some((l) => l.visible)) return toastMessage('Нет видимых слоёв')
    setBusy('Объединяем видимые слои…')
    try {
      const canvas = await exportCanvas(doc)
      const layer = bitmapLayer(
        makeLayer({
          kind: 'image',
          name: 'Объединённые слои',
          width: doc.width,
          height: doc.height,
        }),
        canvas,
      )
      validateRasterBudget({ ...doc, layers: [...doc.layers.filter((l) => !l.visible), layer] })
      editor.change(
        (d) => ({
          ...d,
          background: 'transparent',
          layers: [...d.layers.filter((l) => !l.visible), layer],
        }),
        'Объединение видимых слоёв',
      )
      setSelectedId(layer.id)
    } catch {
      toastMessage('Не удалось объединить слои')
    } finally {
      setBusy(null)
    }
  }
  const saveProject = async () => {
    if (workspace.activeTab?.parent) {
      await workspace.applySmart()
      return
    }
    setBusy('Сохраняем настоящий PSD со слоями…')
    try {
      const result = await FileManager.save(editor.documentRef.current)
      toastMessage(
        window.fsh777?.saveFile
          ? `Файл сохранён: ${result.filename}`
          : 'PSD подготовлен к скачиванию.',
      )
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Ошибка сохранения PSD')
    } finally {
      setBusy(null)
    }
  }
  const saveBackup = async () => {
    try {
      const current = editor.documentRef.current
      const layers = await Promise.all(
        current.layers.map(async (l) => {
          if (!l.src?.startsWith('/')) return l
          const image = await loadImage(l.src)
          const buffer = document.createElement('canvas')
          buffer.width = image.width
          buffer.height = image.height
          buffer.getContext('2d')!.drawImage(image, 0, 0)
          return { ...l, src: buffer.toDataURL('image/webp', 0.95) }
        }),
      )
      const filename = await downloadBlob(
        new Blob([JSON.stringify({ ...current, layers })], { type: 'application/json' }),
        `${current.name.replace(/[\\/:*?"<>|]/g, '_')}.777`,
      )
      toastMessage(
        window.fsh777?.saveFile
          ? `Файл сохранён: ${filename}`
          : 'Резервная копия .777 подготовлена к скачиванию.',
      )
    } catch {
      toastMessage('Не удалось сохранить проект. Попробуй ещё раз.')
    }
  }
  const importFiles = async (files: File[]) => {
    if (!files.length || busy) return
    setBusy('Открываем файлы…')
    try {
      const actionFile = files.find((f) => /\.atn$|\.777actions\.json$/i.test(f.name))
      if (actionFile) {
        if (actionFile.size > 8 * 1024 * 1024)
          throw new Error('Набор операций должен быть меньше 8 МБ')
        const imported = /\.atn$/i.test(actionFile.name)
          ? parseAtn(await actionFile.arrayBuffer())
          : parseActionSet(JSON.parse(await actionFile.text()))
        if (actions.length + imported.length > 100)
          throw new Error('До 100 операций в наборе. Удали ненужные перед импортом.')
        setActions((a) => [...a, ...imported])
        setModal('actions')
        toastMessage(`Импортировано операций: ${imported.length}. Проверь поддержку шагов.`)
        return
      }
      const layered = files.find((f) => /\.(psd|psb)$/i.test(f.name))
      if (layered) {
        if (layered.size > 80 * 1024 * 1024) throw new Error('PSD/PSB: размер файла до 80 МБ')
        setBusy('Читаем слои PSD/PSB…')
        const { importPsd } = await import('./engine/psd')
        const result = await importPsd(await layered.arrayBuffer(), layered.name)
        await prepareDocument(result.document)
        setPendingDocument(result.document)
        setCompatibility(result.report)
        return
      }
      const project = files.find((f) => /\.(777|fsh777)$/i.test(f.name))
      if (project) {
        if (project.size > 50 * 1024 * 1024) throw new Error('Проект должен быть меньше 50 МБ')
        const next = parseProject(JSON.parse(await project.text()))
        await prepareDocument(next)
        setPendingDocument(next)
        return
      }
      const fromHome = workspace.home
      let destination = doc
      const added: Layer[] = []
      for (const file of files.slice(0, 10)) {
        if (doc.layers.length + added.length >= MAX_LAYERS)
          throw new Error('В проекте может быть до 100 слоёв')
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw new Error('Поддерживаются PNG, JPEG, WebP, PSD, PSB и проекты .777')
        if (file.size > 25 * 1024 * 1024) throw new Error('Изображение должно быть меньше 25 МБ')
        let src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const image = await loadImage(src)
        let w = image.width,
          h = image.height
        const downscale = Math.min(1, 4096 / w, 4096 / h)
        if (downscale < 1) {
          const buffer = document.createElement('canvas')
          buffer.width = Math.round(w * downscale)
          buffer.height = Math.round(h * downscale)
          buffer.getContext('2d')!.drawImage(image, 0, 0, buffer.width, buffer.height)
          src = buffer.toDataURL('image/png')
          w = buffer.width
          h = buffer.height
          await loadImage(src)
        }
        if (fromHome && !added.length)
          destination = newDocument(w, h, file.name.replace(/\.[^.]+$/, ''), 'transparent')
        const ratio = fromHome
          ? Math.min(1, destination.width / w, destination.height / h)
          : Math.min(1, (doc.width * 0.9) / w, (doc.height * 0.9) / h)
        added.push(
          makeLayer({
            kind: 'image',
            name: file.name.replace(/\.[^.]+$/, ''),
            src,
            width: w * ratio,
            height: h * ratio,
            x: (destination.width - w * ratio) / 2,
            y: (destination.height - h * ratio) / 2,
          }),
        )
      }
      if (added.length) {
        await prepareDocument({ ...destination, layers: [...destination.layers, ...added] })
        if (fromHome) {
          openDocument({ ...destination, layers: added })
          return
        }
        editor.change((d) => ({ ...d, layers: [...d.layers, ...added] }), 'Импорт изображения')
        setSelectedId(added.at(-1)!.id)
        setTool('move')
        toastMessage(`Добавлено изображений: ${added.length}`)
      }
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Не удалось открыть файл')
    } finally {
      setBusy(null)
    }
  }
  const pixelAction = async (
    operation: 'background' | 'wand' | 'erase' | 'fill' | 'bucket',
    point?: Point,
  ) => {
    const fresh =
      !selected && operation === 'bucket'
        ? makeLayer({ kind: 'image', name: 'Заливка', width: doc.width, height: doc.height })
        : undefined
    const target = selected || fresh
    if (fresh && doc.layers.length >= MAX_LAYERS) return toastMessage('Достигнут лимит 100 слоёв')
    if (!target) return toastMessage('Сначала выбери слой с изображением')
    if (target.kind === 'group' || target.smart)
      return toastMessage('Выбери растровый слой или открой содержимое смарт-объекта')
    if (target.locked) return toastMessage('Сначала разблокируй слой')
    if (operation === 'background' && target.kind !== 'image')
      return toastMessage('Удаление фона работает с изображениями')
    if ((operation === 'erase' || operation === 'fill') && !selection)
      return toastMessage('Сначала выдели область инструментом M')
    const local = point ? localPoint(target, point) : undefined
    if (
      local &&
      (local.x < 0 || local.y < 0 || local.x >= target.width || local.y >= target.height)
    )
      return toastMessage('Кликни внутри выбранного слоя')
    setBusy(
      operation === 'background'
        ? 'Убираем фон на твоём устройстве…'
        : operation === 'fill'
          ? 'Заполняем цветами окружения…'
          : 'Обрабатываем выделение…',
    )
    try {
      const buffer = await rasterizeLayer(target),
        ctx = buffer.getContext('2d', { willReadFrequently: true })!
      const sx = buffer.width / target.width,
        sy = buffer.height / target.height
      let rect: Selection | undefined
      if (selection && (operation === 'erase' || operation === 'fill'))
        rect = { x: 0, y: 0, width: buffer.width, height: buffer.height }
      const pixels = await runPixelOperation({
        operation,
        width: buffer.width,
        height: buffer.height,
        pixels: ctx.getImageData(0, 0, buffer.width, buffer.height).data,
        mask: selection
          ? selectionMask(selection, buffer.width, buffer.height, target)
              .getContext('2d')!
              .getImageData(0, 0, buffer.width, buffer.height).data
          : undefined,
        color: [1, 3, 5]
          .map((i) => parseInt(settings.color.slice(i, i + 2), 16))
          .concat(Math.round(settings.brushOpacity * 2.55)),
        tolerance: settings.tolerance,
        x: local ? local.x * sx : 0,
        y: local ? local.y * sy : 0,
        rect,
      })
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), buffer.width, buffer.height),
        0,
        0,
      )
      const layer = await encodeBitmap(target, buffer)
      validateRasterBudget({
        ...doc,
        layers: fresh
          ? [...doc.layers, layer]
          : doc.layers.map((l) => (l.id === target.id ? layer : l)),
      })
      editor.change(
        (d) => ({
          ...d,
          background: operation === 'background' ? 'transparent' : d.background,
          layers: fresh
            ? [...d.layers, layer]
            : d.layers.map((l) => (l.id === target.id ? layer : l)),
        }),
        operation === 'background'
          ? 'Удаление фона'
          : operation === 'bucket'
            ? 'Заливка цветом'
            : operation === 'fill'
              ? 'Заливка окружением'
              : 'Удаление области',
      )
      if (fresh) setSelectedId(layer.id)
      toastMessage(
        operation === 'background'
          ? 'Фон обработан по цвету краёв. Допуск можно изменить. Ctrl+Z — отменить.'
          : operation === 'bucket'
            ? 'Область залита выбранным цветом.'
            : operation === 'fill'
              ? 'Область заполнена цветами окружения. Для фактур может понадобиться доработка.'
              : 'Область стёрта. Ctrl+Z — отменить.',
      )
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Не удалось обработать изображение')
    } finally {
      setBusy(null)
    }
  }
  const crop = () => {
    if (!selection || selection.width < 1 || selection.height < 1) return
    const x = Math.round(selection.x),
      y = Math.round(selection.y),
      width = Math.max(1, Math.round(selection.width)),
      height = Math.max(1, Math.round(selection.height))
    editor.change(
      (d) => ({
        ...d,
        width,
        height,
        layers: d.layers.map((l) => ({
          ...l,
          x: l.x - x,
          y: l.y - y,
          mask: l.mask ? { ...l.mask, x: l.mask.x - x, y: l.mask.y - y } : undefined,
        })),
      }),
      'Кадрирование холста',
    )
    setSelection(null)
    setTool('move')
    fitView()
    toastMessage(`Холст: ${width} × ${height} px. Слои сохранены.`)
  }
  const extractText = () => {
    if (!selected?.sourceText || selected.locked) return
    if (doc.layers.length >= MAX_LAYERS) return toastMessage('В проекте уже 100 слоёв')
    const layer = makeLayer({
      kind: 'text',
      name: `${selected.name} · текст`,
      text: selected.sourceText,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
      fontFamily: 'Manrope',
      fontSize: Math.max(
        12,
        Math.min(200, selected.height / Math.max(1, selected.sourceText.split('\n').length) / 1.3),
      ),
      color: settings.color,
      fontWeight: 500,
    })
    editor.change(
      (d) => ({
        ...d,
        layers: [
          ...d.layers.map((l) => (l.id === selected.id ? { ...l, visible: false } : l)),
          layer,
        ],
      }),
      'Извлечение текста PSD',
    )
    setSelectedId(layer.id)
    toastMessage('Текст извлечён. Шрифт заменён на Manrope; исходный растр скрыт и сохранён.')
  }
  const fitLayer = () => {
    if (!selected || selected.locked) return
    const ratio = Math.min(doc.width / selected.width, doc.height / selected.height)
    const width = selected.width * ratio,
      height = selected.height * ratio
    editor.patchLayer(
      selected.id,
      { width, height, x: (doc.width - width) / 2, y: (doc.height - height) / 2 },
      'Подгонка слоя под холст',
    )
  }
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.code === 'KeyS' &&
        typing(e.target) &&
        !busy &&
        !modal &&
        !workspace.closing &&
        !pendingDocument
      ) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
        editor.finish('Редактирование')
        void saveProject()
        return
      }
      if (typing(e.target) || busy || modal || pendingDocument || workspace.closing) return
      const mod = e.ctrlKey || e.metaKey
      if (workspace.home) {
        if (mod && e.code === 'KeyN') {
          e.preventDefault()
          setModal('new')
        }
        if (mod && e.code === 'KeyO') {
          e.preventDefault()
          input.current?.click()
        }
        if (mod && e.code === 'Comma') {
          e.preventDefault()
          setModal('settings')
        }
        return
      }
      if (mod && e.code === 'Comma') {
        e.preventDefault()
        setModal('settings')
        return
      }
      const action = actions.find(
        (a) =>
          a.shortcut?.key === e.code && a.shortcut.shift === e.shiftKey && a.shortcut.ctrl === mod,
      )
      if (action) {
        e.preventDefault()
        executeAction(action)
        return
      }
      if (mod) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault()
            if (e.shiftKey) editor.redo()
            else editor.undo()
            return
          case 'KeyY':
            e.preventDefault()
            editor.redo()
            return
          case 'KeyS':
            e.preventDefault()
            if (e.shiftKey) setModal('export')
            else void saveProject()
            return
          case 'KeyO':
            e.preventDefault()
            input.current?.click()
            return
          case 'KeyN':
            e.preventDefault()
            if (e.shiftKey) addEmpty()
            else setModal('new')
            return
          case 'KeyG':
            e.preventDefault()
            if (e.shiftKey) ungroup()
            else group()
            return
          case 'KeyW':
            e.preventDefault()
            workspace.requestClose(doc.id)
            return
          case 'KeyA':
            e.preventDefault()
            setSelection({ x: 0, y: 0, width: doc.width, height: doc.height })
            return
          case 'KeyJ':
            e.preventDefault()
            duplicate()
            return
          case 'KeyC':
            if (selected) {
              e.preventDefault()
              copyLayer()
            }
            return
          case 'KeyI':
            e.preventDefault()
            if (selected && !selected.locked)
              editor.patchLayer(
                selected.id,
                {
                  adjustments: {
                    ...selected.adjustments,
                    invert: selected.adjustments.invert ? 0 : 100,
                  },
                },
                'Инверсия',
              )
            return
          case 'KeyU':
            if (e.shiftKey && selected && !selected.locked) {
              e.preventDefault()
              editor.patchLayer(
                selected.id,
                { adjustments: { ...selected.adjustments, saturation: -100 } },
                'Обесцвечивание',
              )
            }
            return
          case 'KeyE':
            if (e.shiftKey) {
              e.preventDefault()
              void mergeVisible()
            }
            return
          case 'KeyT':
            e.preventDefault()
            setTool('move')
            return
          case 'Digit0':
            e.preventDefault()
            fitView()
            return
          case 'Digit1':
            e.preventDefault()
            setZoom(1)
            setPan({ x: 0, y: 0 })
            return
          case 'Equal':
            e.preventDefault()
            setZoom(Math.min(4, effectiveZoom * 1.2))
            return
          case 'Minus':
            e.preventDefault()
            setZoom(Math.max(0.05, effectiveZoom / 1.2))
            return
          case 'KeyD':
            e.preventDefault()
            setSelection(null)
            return
        }
        return
      }
      if (e.key === 'Escape') {
        setSelection(null)
        setSelectedId(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (selection) void pixelAction('erase')
        else deleteLayer()
        return
      }
      if (e.key.startsWith('Arrow') && selected && !selected.locked) {
        e.preventDefault()
        const amount = e.shiftKey ? 10 : 1
        editor.patchLayer(
          selected.id,
          {
            x: selected.x + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0),
            y: selected.y + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0),
          },
          'Перемещение слоя',
        )
        return
      }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        setSettings({
          brushSize: Math.max(
            1,
            Math.min(500, settings.brushSize + (e.code === 'BracketLeft' ? -5 : 5)),
          ),
        })
        return
      }
      if (e.code === 'KeyX') {
        setSettings({ color: settings.secondaryColor, secondaryColor: settings.color })
        return
      }
      if (e.code === 'KeyD') {
        setSettings({ color: '#000000', secondaryColor: '#ffffff' })
        return
      }
      if (e.key === '?') {
        setModal('help')
        return
      }
      const nextTool = cycleTool(tool, e.code.replace('Key', ''), e.shiftKey)
      if (nextTool) {
        e.preventDefault()
        setTool(nextTool)
      }
    }
    const paste = (e: ClipboardEvent) => {
      if (typing(e.target) || modal || busy || pendingDocument || workspace.closing) return
      const files = Array.from(e.clipboardData?.files || [])
      if (files.length) {
        e.preventDefault()
        void importFiles(files)
      } else if (clipboardLayer) {
        e.preventDefault()
        pasteLayer()
      }
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('paste', paste)
    }
  })
  const [renamingDoc, setRenamingDoc] = useState(false)
  const closeModal = useCallback(() => setModal(null), [])
  const closeReplace = useCallback(() => setPendingDocument(null), [])
  const activeTool = tools.find((t) => t.id === tool)!
  const fileMenu: MenuItem[] = [
    { label: 'Главная / недавние', icon: Home, action: () => void workspace.showHome() },
    { label: 'Новый проект', icon: FilePlus2, shortcut: 'Ctrl N', action: () => setModal('new') },
    {
      label: 'Открыть файл…',
      icon: FolderOpen,
      shortcut: 'Ctrl O',
      action: () => input.current?.click(),
    },
    {
      label: 'Сохранить PSD…',
      icon: Save,
      shortcut: 'Ctrl S',
      action: () => void saveProject(),
      divider: true,
    },
    {
      label: 'Сохранить PSD как…',
      icon: Save,
      action: () => {
        setBusy('Сохраняем PSD…')
        void FileManager.save(editor.documentRef.current, false, true)
          .then((r) =>
            toastMessage(
              window.fsh777?.saveFile ? `Файл сохранён: ${r.filename}` : 'PSD готов к скачиванию',
            ),
          )
          .catch((e) => toastMessage(e.message))
          .finally(() => setBusy(null))
      },
    },
    { label: 'Резервная копия (старый .777)', icon: Save, action: () => void saveBackup() },
    {
      label: 'Экспорт изображения…',
      icon: Download,
      shortcut: 'Ctrl ⇧ S',
      action: () => setModal('export'),
    },
    {
      label: 'Открыть демопроект',
      icon: Sparkles,
      action: () => openDocument(demoDocument()),
      divider: true,
    },
  ]
  const editMenu: MenuItem[] = [
    {
      label: 'Настройки…',
      icon: SlidersHorizontal,
      shortcut: 'Ctrl ,',
      action: () => setModal('settings'),
    },
    {
      label: 'Отменить',
      icon: Undo2,
      shortcut: 'Ctrl Z',
      action: editor.undo,
      disabled: !editor.canUndo,
    },
    {
      label: 'Повторить',
      icon: Redo2,
      shortcut: 'Ctrl ⇧ Z',
      action: editor.redo,
      disabled: !editor.canRedo,
    },
    {
      label: 'Копировать слой',
      icon: Copy,
      shortcut: 'Ctrl C',
      action: copyLayer,
      disabled: !selected,
      divider: true,
    },
    {
      label: 'Вставить слой',
      icon: Copy,
      shortcut: 'Ctrl V',
      action: pasteLayer,
      disabled: !clipboardLayer,
    },
    {
      label: 'Дублировать слой',
      icon: Copy,
      shortcut: 'Ctrl J',
      action: () => duplicate(),
      disabled: !selected,
      divider: true,
    },
    {
      label: 'Удалить слой',
      icon: Trash2,
      shortcut: 'Del',
      action: () => deleteLayer(),
      disabled: !selected || selected.locked,
    },
    {
      label: 'Снять выделение',
      icon: SquareDashed,
      shortcut: 'Esc',
      action: () => setSelection(null),
      disabled: !selection,
      divider: true,
    },
  ]
  const viewMenu: MenuItem[] = [
    { label: 'По размеру окна', icon: Maximize, shortcut: 'Ctrl 0', action: fitView },
    {
      label: 'Масштаб 100%',
      icon: ScanLine,
      shortcut: 'Ctrl 1',
      action: () => {
        setZoom(1)
        setPan({ x: 0, y: 0 })
      },
    },
    { label: 'Приблизить', icon: ZoomIn, action: () => setZoom(Math.min(4, effectiveZoom * 1.25)) },
    {
      label: 'Отдалить',
      icon: ZoomOut,
      action: () => setZoom(Math.max(0.05, effectiveZoom / 1.25)),
    },
    { label: 'Линейки', checked: rulers, action: () => setRulers(!rulers), divider: true },
    {
      label: 'Умные направляющие',
      checked: settings.showGuides,
      action: () => setSettings({ showGuides: !settings.showGuides }),
    },
    { label: 'Панель свойств и слоёв', checked: inspector, action: () => setInspector(!inspector) },
  ]
  const layerMenu: MenuItem[] = [
    {
      label: 'Группировать выбранное',
      icon: FolderPlus,
      shortcut: 'Ctrl G',
      action: () => group(),
    },
    {
      label: 'Разгруппировать',
      icon: Layers3,
      shortcut: 'Ctrl ⇧ G',
      action: () => ungroup(),
      disabled: selected?.kind !== 'group' || selected?.locked,
    },
    {
      label: 'Добавить маску',
      icon: SquareDashed,
      action: () => void addMask(),
      disabled: !selected || selected.locked || !!selected.mask,
    },
    {
      label: 'Преобразовать в смарт-объект',
      icon: SquareStack,
      action: () => void convertSmart(),
      disabled: !selected || selected.locked || !!selected.smart,
    },
    {
      label: 'Открыть содержимое смарт-объекта',
      icon: SquareStack,
      action: () => selectedId && void workspace.openSmart(selectedId),
      disabled: !selected?.smart,
    },

    { label: 'Новый пустой слой', icon: Plus, shortcut: 'Ctrl ⇧ N', action: addEmpty },
    { label: 'Новый текст', icon: Type, action: addText },
    {
      label: 'Стиль слоя…',
      icon: Sparkles,
      action: () => setModal('styles'),
      disabled: !selected || selected.locked,
      divider: true,
    },
    {
      label: 'Растрировать содержимое',
      icon: ImagePlus,
      action: () => void rasterizeSelected(),
      disabled: !selected || selected.locked,
    },
    {
      label: 'Объединить видимые',
      icon: Copy,
      shortcut: 'Ctrl ⇧ E',
      action: () => void mergeVisible(),
      disabled: !doc.layers.some((l) => l.visible),
      divider: true,
    },
    { label: 'Дублировать', icon: Copy, action: () => duplicate(), disabled: !selected },
    {
      label: 'Удалить',
      icon: Trash2,
      action: () => deleteLayer(),
      disabled: !selected || selected.locked,
    },
  ]
  const imageMenu: MenuItem[] = [
    { label: 'Размер изображения…', icon: Maximize, action: () => setModal('image-size') },
    { label: 'Размер холста…', icon: RectangleHorizontal, action: () => setModal('canvas-size') },
    {
      label: 'Прозрачный фон',
      checked: doc.background === 'transparent',
      action: () =>
        editor.change(
          (d) => ({ ...d, background: d.background === 'transparent' ? '#ffffff' : 'transparent' }),
          'Фон документа',
        ),
    },
    {
      label: 'Выделить всё',
      shortcut: 'Ctrl A',
      action: () => setSelection({ x: 0, y: 0, width: doc.width, height: doc.height }),
      divider: true,
    },
    {
      label: 'Инвертировать выделение',
      action: () => selection && setSelection({ ...selection, inverted: !selection.inverted }),
      disabled: !selection,
    },
    {
      label: 'Снять выделение',
      shortcut: 'Ctrl D',
      action: () => setSelection(null),
      disabled: !selection,
    },
  ]
  const filterMenu: MenuItem[] = [
    ...(
      [
        ['Обесцветить', { grayscale: 100 }],
        ['Инверсия', { invert: 100 }],
        ['Сепия', { sepia: 100 }],
        ['Размытие 4 px', { blur: 4 }],
        ['Сбросить коррекцию', DEFAULT_ADJUSTMENTS],
      ] as const
    ).map(([label, adjustment]) => ({
      label,
      action: () =>
        selected &&
        editor.patchLayer(
          selected.id,
          { adjustments: { ...selected.adjustments, ...adjustment } },
          label,
        ),
      disabled: !selected || selected.locked || selected.kind === 'group',
    })),
    {
      label: 'Удалить связанный фон',
      action: () => void pixelAction('background'),
      disabled: selected?.kind !== 'image' || selected.locked,
      divider: true,
    },
    { label: 'Наборы операций…', action: () => setModal('actions') },
  ]
  const windowMenu: MenuItem[] = [
    {
      label: 'Свойства / слои / история',
      checked: inspector,
      action: () => setInspector(!inspector),
    },
    { label: 'Библиотека шрифтов…', icon: Type, action: () => setModal('fonts') },
    { label: 'Настройки…', icon: SlidersHorizontal, action: () => setModal('settings') },
    ...workspace.tabs.map((t) => ({
      label: t.id === doc.id ? doc.name : t.name,
      checked: t.id === doc.id,
      action: () => void workspace.switchTo(t.id),
    })),
  ]
  const helpMenu: MenuItem[] = [
    { label: 'Библиотека шрифтов…', icon: Type, action: () => setModal('fonts') },
    { label: 'Горячие клавиши', icon: Keyboard, shortcut: '?', action: () => setModal('help') },
    { label: 'О ФШ 777', icon: Sparkles, action: () => setModal('about') },
  ]

  return (
    <div
      className="editor-app"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          dragCounter.current++
          setDropping(true)
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dragCounter.current--
          if (dragCounter.current <= 0) setDropping(false)
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          dragCounter.current = 0
          setDropping(false)
          void importFiles(Array.from(e.dataTransfer.files))
        }
      }}
    >
      {workspace.home && (
        <HomeScreen
          recents={workspace.recents}
          recovery={workspace.recovery}
          hasSession={workspace.tabs.length > 0}
          onNew={() => setModal('new')}
          onOpen={() => input.current?.click()}
          onDemo={() => openDocument(demoDocument())}
          onResume={workspace.resume}
          onRecent={(r) => void workspace.openRecent(r)}
          onRestore={() => workspace.recovery && void workspace.openRecent(workspace.recovery)}
          onForget={(id) => void workspace.forget(id)}
          onFonts={() => setModal('fonts')}
          onSettings={() => setModal('settings')}
        />
      )}
      <div className="editor-shell" hidden={workspace.home}>
        <header className="app-header">
          <button
            className="brand"
            onClick={() => setModal('about')}
            aria-label="О редакторе ФШ 777"
          >
            <span className="brand-mark">
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path d="M7 7h20v5L16 26H7l12-13H7z" fill="currentColor" />
              </svg>
            </span>
            <span className="brand-name">
              ФШ <b>777</b>
            </span>
            <span className="beta-badge">BETA</span>
          </button>
          <nav className="main-menu" aria-label="Меню редактора">
            <Dropdown label="Файл" items={fileMenu} />
            <Dropdown label="Правка" items={editMenu} />
            <Dropdown label="Изображение" items={imageMenu} />
            <Dropdown label="Слой" items={layerMenu} />
            <Dropdown label="Вид" items={viewMenu} />
            <Dropdown label="Фильтры" items={filterMenu} />
            <Dropdown label="Окно" items={windowMenu} />
            <Dropdown label="Помощь" items={helpMenu} />
          </nav>
          <div
            className={`save-indicator ${saveStatus}`}
            title="Локальная копия для восстановления. PSD на диске сохраняется отдельно через Ctrl+S."
          >
            {saveStatus === 'saving' ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <HardDrive size={14} />
            )}
            <span>
              {saveStatus === 'saved'
                ? 'Автокопия сохранена'
                : saveStatus === 'saving'
                  ? 'Сохраняем на устройстве…'
                  : 'Скачай проект для сохранения'}
            </span>
          </div>
          <div className="header-actions">
            <span className="private-badge">
              <span />
              Локально. Приватно.
            </span>
            <button className="export-button" onClick={() => setModal('export')} disabled={!!busy}>
              <Download size={15} />
              Экспорт
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <div className="options-bar">
          <div className="history-buttons">
            <IconButton
              icon={Undo2}
              label="Отменить (Ctrl+Z)"
              disabled={!editor.canUndo || !!busy}
              onClick={editor.undo}
            />
            <IconButton
              icon={Redo2}
              label="Повторить (Ctrl+Shift+Z)"
              disabled={!editor.canRedo || !!busy}
              onClick={editor.redo}
            />
          </div>
          <div className="vertical-divider" />
          <div className="current-tool">
            <activeTool.icon size={16} />
            <span>{activeTool.name}</span>
          </div>
          <div className="vertical-divider" />
          <div className="tool-options">
            {tool === 'move' ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.autoSelect}
                    onChange={(e) => setSettings({ autoSelect: e.target.checked })}
                  />
                  Автовыбор слоя
                </label>
                <label className="checkbox-row guides-option">
                  <input
                    type="checkbox"
                    checked={settings.showGuides}
                    onChange={(e) => setSettings({ showGuides: e.target.checked })}
                  />
                  Направляющие
                </label>
              </>
            ) : tool === 'brush' || tool === 'eraser' || tool === 'clone' ? (
              <>
                <Field
                  label="Размер"
                  value={settings.brushSize}
                  min={1}
                  max={500}
                  suffix="px"
                  onChange={(brushSize) => setSettings({ brushSize })}
                />
                <Field
                  label="Непр."
                  value={settings.brushOpacity}
                  min={1}
                  max={100}
                  suffix="%"
                  onChange={(brushOpacity) => setSettings({ brushOpacity })}
                />
                <Field
                  label="Жёсткость"
                  value={settings.brushHardness ?? 100}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(brushHardness) => setSettings({ brushHardness })}
                />
                <Field
                  label="Интервал"
                  value={settings.brushSpacing || 15}
                  min={5}
                  max={100}
                  suffix="%"
                  onChange={(brushSpacing) => setSettings({ brushSpacing })}
                />
                {tool === 'clone' && (
                  <span className="tool-instruction">Alt+клик — источник · текущий слой</span>
                )}
              </>
            ) : tool === 'wand' || tool === 'bucket' ? (
              <>
                <Field
                  label="Допуск"
                  value={settings.tolerance}
                  min={1}
                  max={75}
                  suffix="%"
                  onChange={(tolerance) => setSettings({ tolerance })}
                />
                <span className="tool-instruction">
                  {tool === 'bucket'
                    ? 'Заливка связанной области цветом'
                    : 'Кликни по области, которую хочешь стереть'}
                </span>
              </>
            ) : selectionTools.includes(tool) ? (
              <>
                <Field
                  label="Растушёвка"
                  value={settings.feather || 0}
                  min={0}
                  max={50}
                  suffix="px"
                  onChange={(feather) => setSettings({ feather })}
                />
                <span className="tool-instruction">
                  {tool === 'polygon-lasso' || tool === 'magnetic-lasso'
                    ? 'Клики задают контур · Enter / двойной клик замыкает'
                    : 'Обведи область · Ctrl+D — снять выделение'}
                </span>
              </>
            ) : tool === 'gradient' ? (
              <Select
                aria-label="Тип градиента"
                value={settings.gradientType || 'linear'}
                onChange={(e) =>
                  setSettings({ gradientType: e.target.value as 'linear' | 'radial' })
                }
              >
                <option value="linear">Линейный</option>
                <option value="radial">Радиальный</option>
              </Select>
            ) : (
              <span className="tool-instruction">
                {tool === 'text'
                  ? 'Нажми на холст и напиши свою историю'
                  : tool === 'crop'
                    ? 'Выдели область, которую хочешь оставить'
                    : tool === 'select'
                      ? 'Выдели область для стирания или заливки'
                      : tool === 'eyedropper'
                        ? 'Выбери любой цвет на холсте'
                        : tool === 'hand'
                          ? 'Перетаскивай холст. Ctrl + колесо — масштаб'
                          : 'Потяни на холсте. Shift — ровные пропорции'}
              </span>
            )}
            {['brush', 'rectangle', 'ellipse', 'text', 'bucket', 'gradient'].includes(tool) && (
              <label className="option-color" title="Основной цвет">
                <input
                  type="color"
                  aria-label="Цвет инструмента"
                  value={settings.color}
                  onChange={(e) => setSettings({ color: e.target.value })}
                />
                <span style={{ background: settings.color }} />
              </label>
            )}
          </div>
          <div className="options-right">
            <button
              className="add-image-button"
              onClick={() => input.current?.click()}
              disabled={!!busy}
            >
              <ImagePlus size={16} />
              <span>Добавить изображение</span>
            </button>
            <div className="vertical-divider" />
            <IconButton
              icon={inspector ? PanelRightClose : PanelRightOpen}
              label={inspector ? 'Скрыть панели' : 'Показать панели'}
              onClick={() => setInspector(!inspector)}
            />
          </div>
        </div>
        <div className="editor-body">
          <aside className="toolbar" aria-label="Инструменты">
            <ToolRail tool={tool} onSelect={setTool} />
            <div className="toolbar-colors">
              <button
                className="swap-colors"
                title="Поменять цвета (X)"
                aria-label="Поменять цвета"
                onClick={() =>
                  setSettings({ color: settings.secondaryColor, secondaryColor: settings.color })
                }
              >
                <ArrowLeftRight size={11} />
              </button>
              <label
                className="secondary-color"
                style={{ background: settings.secondaryColor }}
                title="Фоновый цвет"
              >
                <input
                  type="color"
                  aria-label="Фоновый цвет инструмента"
                  value={settings.secondaryColor}
                  onChange={(e) => setSettings({ secondaryColor: e.target.value })}
                />
              </label>
              <button
                className="primary-color"
                style={{ background: settings.color }}
                title="Основной цвет"
                aria-label="Выбрать основной цвет"
                onClick={() => setModal('color')}
              />
            </div>
            <div className="toolbar-bottom">
              <IconButton
                icon={Keyboard}
                label="Горячие клавиши"
                onClick={() => setModal('help')}
              />
              <IconButton icon={CircleHelp} label="О редакторе" onClick={() => setModal('about')} />
            </div>
          </aside>
          <main className="workspace">
            <div className="document-bar">
              <IconButton
                icon={Home}
                label="На главную"
                onClick={() => void workspace.showHome()}
              />
              <div className="open-document-tabs">
                {workspace.tabs.map((t) =>
                  t.id === doc.id ? (
                    <div className="document-tab active" key={t.id}>
                      <span className="document-dot" />
                      {renamingDoc ? (
                        <input
                          autoFocus
                          aria-label="Название проекта"
                          value={doc.name}
                          maxLength={80}
                          onChange={(e) =>
                            editor.change((d) => ({ ...d, name: e.target.value }), '', true)
                          }
                          onBlur={() => {
                            if (!editor.documentRef.current.name.trim())
                              editor.change((d) => ({ ...d, name: 'Без названия' }), '', true)
                            editor.finish('Название проекта')
                            setRenamingDoc(false)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
                          }}
                        />
                      ) : (
                        <button
                          className="document-name"
                          title="Нажми, чтобы переименовать проект"
                          onClick={() => setRenamingDoc(true)}
                        >
                          {doc.name}
                          <span>.psd</span>
                        </button>
                      )}
                      <span className="document-unsaved">{saveStatus === 'saving' ? '•' : ''}</span>
                      <button
                        aria-label={`Закрыть вкладку: ${doc.name}`}
                        onClick={() => workspace.requestClose(doc.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="document-tab inactive" key={t.id}>
                      <button onClick={() => void workspace.switchTo(t.id)}>
                        {t.name}
                        <span>.psd</span>
                      </button>
                      <button
                        aria-label={`Закрыть вкладку: ${t.name}`}
                        onClick={() => workspace.requestClose(t.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ),
                )}
              </div>
              <IconButton
                icon={Plus}
                label="Создать новый проект"
                onClick={() => setModal('new')}
              />
              <div className="document-meta">
                <span>
                  {doc.width} × {doc.height} px
                </span>
                <span className="color-profile">RGB / 8</span>
              </div>
            </div>
            {workspace.activeTab?.parent && (
              <div className="smart-document-bar">
                <SquareStack size={14} />
                <span>Содержимое смарт-объекта · изменения применяются отдельно</span>
                <button onClick={() => void workspace.applySmart()}>
                  Применить в документ · Ctrl+S
                </button>
              </div>
            )}
            {!workspace.home && (
              <CanvasStage
                editor={editor}
                selectedId={selectedId}
                onSelect={setSelectedId}
                tool={tool}
                setTool={setTool}
                settings={settings}
                setColor={(color) => setSettings({ color })}
                zoom={zoom}
                setZoom={setZoom}
                onEffectiveZoom={setEffectiveZoom}
                pan={pan}
                setPan={setPan}
                selection={selection}
                setSelection={setSelection}
                onCrop={crop}
                onPixelAction={(op, point) => void pixelAction(op, point)}
                onToast={toastMessage}
                onBusy={setBusy}
                smooth={preferences.smooth}
                showPerformance={preferences.showPerformance}
                rulers={rulers}
                busy={!!busy}
                onOpenSmart={(id) => void workspace.openSmart(id)}
              />
            )}
            <footer className="workspace-status">
              <span className="status-left">
                <span className="status-dot" />
                Все инструменты — на твоей стороне
                <span className="status-divider" />
                {selected ? selected.name : 'Холст'}
              </span>
              <div className="zoom-controls">
                <IconButton
                  icon={Minus}
                  label="Уменьшить масштаб"
                  disabled={effectiveZoom <= 0.05}
                  onClick={() => setZoom(Math.max(0.05, effectiveZoom / 1.25))}
                />
                <Select
                  aria-label="Масштаб холста"
                  value={zoom === null ? 'fit' : String(zoom)}
                  onChange={(e) => {
                    if (e.target.value === 'fit') fitView()
                    else {
                      setZoom(+e.target.value)
                      setPan({ x: 0, y: 0 })
                    }
                  }}
                >
                  <option value="fit">
                    {zoom === null ? `${Math.round(effectiveZoom * 100)}%` : 'По размеру окна'}
                  </option>
                  {zoom !== null && ![0.25, 0.5, 0.75, 1, 1.5, 2, 4].includes(zoom) && (
                    <option value={String(zoom)}>{Math.round(zoom * 100)}%</option>
                  )}
                  {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((z) => (
                    <option key={z} value={String(z)}>
                      {z * 100}%
                    </option>
                  ))}
                </Select>
                <IconButton
                  icon={Plus}
                  label="Увеличить масштаб"
                  disabled={effectiveZoom >= 4}
                  onClick={() => setZoom(Math.min(4, effectiveZoom * 1.25))}
                />
                <div className="vertical-divider" />
                <IconButton icon={Maximize} label="Вписать холст (Ctrl+0)" onClick={fitView} />
              </div>
            </footer>
          </main>
          {inspector && (
            <aside className="inspector" aria-label="Свойства и слои">
              <PropertiesPanel
                editor={editor}
                layer={selected}
                onStyle={() => setModal('styles')}
                onFonts={() => setModal('fonts')}
                onExtractText={extractText}
                onRemoveBackground={() => void pixelAction('background')}
                onFitLayer={fitLayer}
                onImport={() => input.current?.click()}
                onAddText={addText}
                onMask={() => void addMask()}
                onOpenSmart={() => selectedId && void workspace.openSmart(selectedId)}
                onParent={(parent) => {
                  if (selectedId)
                    try {
                      editor.change(
                        (d) => moveLayer(d, selectedId, 0, parent),
                        'Родительская группа',
                      )
                    } catch (e) {
                      toastMessage(e instanceof Error ? e.message : 'Ошибка группы')
                    }
                }}
                settings={settings}
                setSettings={setSettings}
                busy={!!busy}
              />
              <LayersPanel
                editor={editor}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAdd={addEmpty}
                onDuplicate={duplicate}
                onDelete={deleteLayer}
                onReorder={reorder}
                onGroup={group}
                onUngroup={ungroup}
                onMask={(id) => void addMask(id)}
                onSmart={() => void convertSmart()}
                onOpenSmart={(id) => void workspace.openSmart(id)}
                editingMask={!!settings.editMask}
                onPixels={() => setSettings({ editMask: false })}
              />
              <div className="inspector-footer">
                <ShieldCheck size={12} />
                <span>Твои файлы остаются у тебя</span>
                <span className="footer-777">777</span>
              </div>
            </aside>
          )}
        </div>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,.777,.fsh777,.psd,.psb,.atn,.777actions.json"
        multiple
        aria-label="Открыть изображение или проект"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
      {workspace.closing && workspace.closingDocument && (
        <CloseDocumentDialog
          name={workspace.closingDocument.name}
          smart={!!workspace.tabs.find((t) => t.id === workspace.closing)?.parent}
          onSave={() => {
            const closing = workspace.closingDocument!
            setBusy('Сохраняем PSD…')
            void FileManager.save(closing)
              .catch((e) => toastMessage(e.message))
              .finally(() => setBusy(null))
          }}
          onApply={() => void workspace.applySmart(workspace.closing!)}
          onConfirm={() => void workspace.close()}
          onCancel={() => workspace.setClosing(null)}
        />
      )}
      {(modal === 'image-size' || modal === 'canvas-size') && (
        <ImageSizeDialog
          doc={doc}
          resize={modal === 'image-size'}
          onApply={imageSize}
          onClose={closeModal}
        />
      )}
      {modal === 'settings' && (
        <SettingsDialog value={preferences} onChange={setPreferences} onClose={closeModal} />
      )}
      {modal === 'fonts' && (
        <FontsDialog
          onClose={closeModal}
          onChoose={(fontFamily) => {
            if (selected?.kind === 'text' && !selected.locked)
              editor.patchLayer(selected.id, { fontFamily }, 'Шрифт')
            else toastMessage(`Шрифт ${fontFamily} доступен в свойствах текста`)
          }}
        />
      )}
      {modal === 'new' && (
        <NewDocumentDialog
          onClose={closeModal}
          onSave={() => void saveProject()}
          onCreate={(w, h, name, bg) => openDocument(newDocument(w, h, name, bg))}
        />
      )}
      {modal === 'export' && (
        <ExportDialog
          doc={doc}
          onClose={closeModal}
          onSave={() => void saveProject()}
          onToast={toastMessage}
        />
      )}
      {(modal === 'help' || modal === 'about') && (
        <HelpDialog onClose={closeModal} initialTab={modal === 'about' ? 'about' : 'shortcuts'} />
      )}
      {modal === 'color' && (
        <ColorDialog
          color={settings.color}
          onClose={closeModal}
          onApply={(color) => {
            setSettings({ color })
            if (selected && !selected.locked && selected.kind !== 'image')
              editor.patchLayer(selected.id, { color }, 'Цвет слоя')
            closeModal()
          }}
        />
      )}
      {modal === 'actions' && (
        <ActionsDialog
          actions={actions}
          onClose={closeModal}
          onImport={() => input.current?.click()}
          onRun={executeAction}
          onCapture={captureAction}
          onDelete={(id) => setActions((a) => a.filter((v) => v.id !== id))}
          canRun={!!selected && !selected.locked}
        />
      )}
      {modal === 'styles' && selected && (
        <LayerStyleDialog
          layer={selected}
          onClose={closeModal}
          onApply={(styles) => {
            editor.patchLayer(selected.id, { styles }, 'Стиль слоя')
            closeModal()
          }}
        />
      )}
      {pendingDocument && compatibility && (
        <CompatibilityDialog
          report={compatibility}
          onClose={() => {
            setPendingDocument(null)
            setCompatibility(null)
          }}
          onSave={() => void saveProject()}
          onConfirm={() => openDocument(pendingDocument)}
        />
      )}
      {pendingDocument && !compatibility && (
        <ReplaceDialog
          name={pendingDocument.name}
          onClose={closeReplace}
          onSave={() => void saveProject()}
          onConfirm={() => openDocument(pendingDocument)}
        />
      )}
      {busy && (
        <div className="busy-overlay" role="status">
          <div>
            <LoaderCircle className="spin" size={22} />
            <span>{busy}</span>
            <small>Никаких загрузок на сервер</small>
          </div>
        </div>
      )}
      {dropping && (
        <div className="drop-overlay">
          <div>
            <ImagePlus size={40} strokeWidth={1.3} />
            <h2>Дай идее место на холсте</h2>
            <p>Отпусти изображение или PSD здесь</p>
            <span>PNG · JPEG · WebP</span>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Check size={14} />
          </span>
          <span>{toast}</span>
          <button aria-label="Закрыть уведомление" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="small-screen-note">
        <span className="brand-mark">
          <Sparkles size={22} />
        </span>
        <h2>Идеям нужно чуть больше места</h2>
        <p>
          Открой редактор на компьютере или поверни планшет. Для удобной работы нужен экран от 640
          px.
        </p>
      </div>
    </div>
  )
}
