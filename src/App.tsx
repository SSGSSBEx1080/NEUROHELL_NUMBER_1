import { usePathTool } from './hooks/usePathTool'
import { defaultRasterFilter, type RasterFilter } from './engine/rasterFilters'
import { isRetouchTool } from './engine/retouch'
import { insertFilteredCopy } from './engine/filterLayers'
import { changeLayerMask, maskOperationNames, type MaskOperation } from './engine/maskOperations'
import { layoutOf, normalizeLayout, transformLayout, type DocumentLayout } from './engine/layout'
import { rasterSelection, type SelectionModify } from './engine/selectionPixels'
import { runSelection } from './engine/selectionJob'
import { selectionSource } from './engine/selectionSource'
import { insertAdjustment } from './engine/adjustmentLayers'
import { correctionNames, type CorrectionKind } from './engine/adjustmentTypes'
import type { PsdExportReport } from './engine/psdReport'
import { insertRepairLayer } from './engine/repairPlacement'
import { ActionsPanel } from './components/ActionsPanel'
import { PanelDock } from './components/PanelDock'
import { loadPanelLayout, savePanelLayout, panelPreset, type DockTab } from './engine/panelLayout'
import { useActionRecorder } from './hooks/useActionRecorder'
import {
  loadActionLibrary,
  storeActionLibrary,
  recoverActionDraft,
  hasPendingActionDraft,
} from './engine/actionStorage'
import { RecordingBar } from './components/RecordingBar'
const TextEntriesPanel = lazy(() =>
  import('./components/TextEntriesPanel').then((m) => ({ default: m.TextEntriesPanel })),
)
import { useEasterEggs } from './hooks/useEasterEggs'
import { HomeScreen } from './components/HomeScreen'
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
import type { EditorCommand } from './components/CommandPalette'
import { selectionModeNames, selectionModifyNames } from './components/selection-labels'

// Dialogs load on first open so the initial workspace bundle stays small; behavior is identical.
const ExportLutDialog = lazy(() =>
  import('./components/ExportLutDialog').then((m) => ({ default: m.ExportLutDialog })),
)
const RasterFilterDialog = lazy(() =>
  import('./components/RasterFilterDialog').then((m) => ({ default: m.RasterFilterDialog })),
)
const LiquifyDialog = lazy(() =>
  import('./components/LiquifyDialog').then((m) => ({ default: m.LiquifyDialog })),
)
const FrequencyDialog = lazy(() =>
  import('./components/FrequencyDialog').then((m) => ({ default: m.FrequencyDialog })),
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
)
const ArrangeDialog = lazy(() =>
  import('./components/ArrangeDialog').then((m) => ({ default: m.ArrangeDialog })),
)
const GuidesDialog = lazy(() =>
  import('./components/GuidesDialog').then((m) => ({ default: m.GuidesDialog })),
)
const ColorRangeDialog = lazy(() =>
  import('./components/ColorRangeDialog').then((m) => ({ default: m.ColorRangeDialog })),
)
const SelectionModifyDialog = lazy(() =>
  import('./components/SelectionModifyDialog').then((m) => ({ default: m.SelectionModifyDialog })),
)
const CorrectionDialog = lazy(() =>
  import('./components/CorrectionDialog').then((m) => ({ default: m.CorrectionDialog })),
)
const PsdReportDialog = lazy(() =>
  import('./components/PsdReportDialog').then((m) => ({ default: m.PsdReportDialog })),
)
const RepairDialog = lazy(() =>
  import('./components/RepairDialog').then((m) => ({ default: m.RepairDialog })),
)
const ImageSizeDialog = lazy(() =>
  import('./components/ImageSizeDialog').then((m) => ({ default: m.ImageSizeDialog })),
)
const CloseDocumentDialog = lazy(() =>
  import('./components/CloseDocumentDialog').then((m) => ({ default: m.CloseDocumentDialog })),
)
const FontsDialog = lazy(() =>
  import('./components/FontsDialog').then((m) => ({ default: m.FontsDialog })),
)
const SettingsDialog = lazy(() =>
  import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
)
const ColorDialog = lazy(() =>
  import('./components/ColorDialog').then((m) => ({ default: m.ColorDialog })),
)
const ActionsDialog = lazy(() =>
  import('./components/ActionsDialog').then((m) => ({ default: m.ActionsDialog })),
)
const LayerStyleDialog = lazy(() =>
  import('./components/LayerStyleDialog').then((m) => ({ default: m.LayerStyleDialog })),
)
const GlobalLightDialog = lazy(() =>
  import('./components/GlobalLightDialog').then((m) => ({ default: m.GlobalLightDialog })),
)
const GradientToolDialog = lazy(() =>
  import('./components/GradientToolDialog').then((m) => ({ default: m.GradientToolDialog })),
)
const BatchDialog = lazy(() =>
  import('./components/BatchDialog').then((m) => ({ default: m.BatchDialog })),
)
const ImportReportDialog = lazy(() =>
  import('./components/CompatibilityDialog').then((m) => ({ default: m.ImportReportDialog })),
)
const PsdColorProfileDialog = lazy(() =>
  import('./components/ColorProfileDialogs').then((m) => ({
    default: m.PsdColorProfileDialog,
  })),
)
const DocumentProfileDialog = lazy(() =>
  import('./components/ColorProfileDialogs').then((m) => ({
    default: m.DocumentProfileDialog,
  })),
)
const ExportDialog = lazy(() =>
  import('./components/Dialogs').then((m) => ({ default: m.ExportDialog })),
)
const HelpDialog = lazy(() =>
  import('./components/Dialogs').then((m) => ({ default: m.HelpDialog })),
)
const NewDocumentDialog = lazy(() =>
  import('./components/Dialogs').then((m) => ({ default: m.NewDocumentDialog })),
)
const ReplaceDialog = lazy(() =>
  import('./components/Dialogs').then((m) => ({ default: m.ReplaceDialog })),
)
const dialogFallback = (
  <div className="busy-overlay" role="status">
    <div>
      <LoaderCircle className="spin" size={22} />
      <span>Загружаем окно…</span>
    </div>
  </div>
)
import { loadSystemFonts, restoreFonts } from './engine/fonts'
import { ToolRail, TOOLS as tools, cycleTool, selectionTools } from './components/ToolRail'
import { selectionMask, combineSelection, invertSelection } from './engine/selection'
import { loadPreferences, savePreferences } from './engine/preferences'
import { FileManager } from './engine/fileManager'
import { parseActionSet, runAction, type StudioAction } from './engine/actions'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  Blend,
  Search,
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
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Save,
  ScanLine,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Sun,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { BrandMark } from './components/Brand'
import { gradientCss, solidGradient } from './engine/gradientRamp'
import type { CompatibilityReport } from './engine/psd'
import type { PsdColorProfileChoice } from './components/ColorProfileDialogs'
import type { DocumentColorDecision } from './engine/documentColor'
import {
  builtinColorProfile,
  documentColorProfileLabel,
  type ColorProfileModel,
} from './engine/colorProfiles'
import { CanvasStage } from './components/CanvasStage'
import { PropertiesPanel } from './components/PropertiesPanel'
import { LayersPanel } from './components/LayersPanel'
import { Dropdown, type MenuItem } from './components/Dropdown'
import { IconButton, Select, SliderField } from './components/ui'
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
  countLinkedGlobalLightEffects,
  effectiveGlobalLight,
  normalizeGlobalLight,
  synchronizeDocumentGlobalLight,
  synchronizeStylesToGlobalLight,
} from './engine/globalLight'
import {
  encodeBitmap,
  bitmapLayer,
  downloadBlob,
  exportCanvas,
  loadImage,
  prepareDocument,
  validateRasterBudget,
  rasterizeLayer,
  rasterizedGeometry,
} from './engine/render'
import { saveDocument, hasPendingWrites } from './engine/storage'
import { runPixelOperation } from './engine/processing'
import {
  MAX_LAYERS,
  type EditorDocument,
  type Layer,
  type Point,
  type Selection,
  type SelectionMode,
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
  const layout = layoutOf(doc)
  const { selectedId, setSelectedId } = editor
  const selectedLayer = doc.layers.find((l) => l.id === selectedId)
  const selected = selectedLayer
    ? { ...selectedLayer, locked: isLayerLocked(doc, selectedLayer.id) }
    : undefined
  const [tool, setTool] = useState<Tool>('move')
  const [settings, updateSettings] = useState<ToolSettings>({
    color: '#000000',
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
  const { pixelSelection: selection, setPixelSelection: setSelection } = editor
  const [preferences, setPreferences] = useState(loadPreferences)
  useEffect(() => {
    savePreferences(preferences)
    document.documentElement.dataset.theme = preferences.theme
    document.documentElement.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full'
    document.documentElement.style.setProperty('--checker-size', `${preferences.checker}px`)
  }, [preferences])
  const [rulers, setRulers] = useState(true)
  const [inspector, setInspector] = useState(true)
  const [panelLayout, setPanelLayout] = useState(loadPanelLayout)
  const dockTab = panelLayout.tab
  const setDockTab = (tab: DockTab) => setPanelLayout((p) => ({ ...p, tab }))
  useEffect(() => savePanelLayout(panelLayout), [panelLayout])
  const [modal, setModal] = useState<
    | 'new'
    | 'export'
    | 'help'
    | 'about'
    | 'styles'
    | 'global-light'
    | 'actions'
    | 'color'
    | 'settings'
    | 'fonts'
    | 'image-size'
    | 'canvas-size'
    | 'repair'
    | 'psd-report'
    | 'import-report'
    | 'document-profile'
    | 'export-lut'
    | 'correction'
    | 'color-range'
    | 'selection-modify'
    | 'guides'
    | 'arrange'
    | 'commands'
    | 'raster-filter'
    | 'liquify'
    | 'frequency'
    | 'gradient-tool'
    | 'batch'
    | null
  >(null)
  const [lastFilter, setLastFilter] = useState<RasterFilter | null>(null)
  const [arrangeIds, setArrangeIds] = useState<string[]>([])
  const [selectionModify, setSelectionModify] = useState<SelectionModify>('expand')
  const recorder = useActionRecorder(editor)
  const [actions, setActions] = useState<StudioAction[]>(loadActionLibrary)
  const [actionsError, setActionsError] = useState('')
  const [clipboardLayer, setClipboardLayer] = useState<Layer | null>(null)
  const [lastExport, setLastExport] = useState<{
    documentId: string
    filename: string
    report: PsdExportReport
  } | null>(null)
  const [pendingColorImport, setPendingColorImport] = useState<{
    fileName: string
    report: CompatibilityReport
  } | null>(null)
  const [lastImportReport, setLastImportReport] = useState<{
    documentId: string
    report: CompatibilityReport
  } | null>(null)
  const [colorProfileBusy, setColorProfileBusy] = useState(false)
  const [pendingDocument, setPendingDocument] = useState<EditorDocument | null>(null)
  const [busy, setBusy] = useState<string | null>('Открываем твою студию…')
  const [ready, setReady] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>('saved')
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
      if (!recorder.recording) {
        const recovered = recoverActionDraft(actions)
        if (recovered !== actions) {
          setActions(recovered)
          return
        }
      }
      storeActionLibrary(actions, !!recorder.recording)
      setActionsError(
        !recorder.recording && hasPendingActionDraft(actions)
          ? 'Сохранён черновик записи, но набор заполнен. Удали ненужную операцию — черновик восстановится автоматически.'
          : '',
      )
    } catch {
      setActionsError(
        'Набор не сохранён в локальном хранилище. Экспортируй JSON, чтобы не потерять операции.',
      )
    }
  }, [actions, !!recorder.recording])
  const startActionRecording = (name: string) => {
    try {
      if (workspace.home) throw new Error('Сначала открой документ')
      if (actions.length >= 100)
        throw new Error('До 100 операций; удали ненужные или экспортируй набор')
      if (hasPendingActionDraft(actions))
        throw new Error('Сначала восстанови прежнюю запись: освободи место в наборе операций.')
      recorder.start(name)
      setModal(null)
      toastMessage(
        'Запись начата. Поддерживаются свойства, стиль, геометрия, дублирование и удаление. Пиксельные операции будут отмечены как неподдерживаемые.',
      )
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Ошибка записи')
    }
  }
  const stopActionRecording = () => {
    try {
      if (actions.length >= 100) throw new Error('Освободи место в наборе: предел 100 операций')
      const action = recorder.stop()
      setActions((a) => [...a, action])
      setModal('actions')
      toastMessage(`Запись сохранена: ${action.steps.length} шагов. Проверь их перед запуском.`)
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Ошибка записи')
    }
  }
  const executeAction = (action: StudioAction) => {
    try {
      if (recorder.recording) throw new Error('Заверши запись перед запуском операции')
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
    setTool('move')
    setSettings({ editMask: false, quickMask: false })
    fitView()
  }
  const workspace = useWorkspace(editor, setBusy, toastMessage, resetView)
  const pathController = usePathTool({
    editor,
    tool,
    setTool,
    settings,
    disabled: !!busy || !!modal || !!pendingDocument || !!workspace.closing || workspace.home,
    onToast: toastMessage,
    onActivate: () => {
      setInspector(true)
      setDockTab('properties')
    },
  })
  useEasterEggs(workspace.home, () => {
    setPreferences((p) => ({ ...p, theme: p.theme === 'aurora' ? 'violet' : 'aurora' }))
    toastMessage(
      '777 · Секретная палитра найдена. Твои пиксели не изменились. Обычную тему можно вернуть в настройках.',
    )
  })
  const openDocument = (next: EditorDocument, importReport?: CompatibilityReport) => {
    // Imported IDs are data, not permission to reuse a former tab's native save path.
    // Recovery uses workspace.openRecent instead and intentionally keeps its session ID.
    const opened = { ...next, id: uid() }
    if (workspace.open(opened)) {
      if (importReport) setLastImportReport({ documentId: opened.id, report: importReport })
      setModal(null)
      setPendingDocument(null)
      setPendingColorImport(null)
      return true
    }
    return false
  }

  const openImportedPsd = async (
    next: EditorDocument,
    report: CompatibilityReport,
    summary: string,
  ) => {
    await prepareDocument(next)
    if (openDocument(next, report))
      toastMessage(
        `PSD открыт: ${next.layers.length} слоёв · ${summary}. Подробности — кнопка «Отчёт импорта» внизу.`,
      )
  }

  const automaticPsdColorDecision = async (
    next: EditorDocument,
    report: CompatibilityReport,
  ): Promise<{ document: EditorDocument; summary: string } | null> => {
    const color = report.color
    if (color.status === 'own') return { document: next, summary: documentColorProfileLabel(next) }
    if (color.status === 'matching')
      return { document: next, summary: color.embeddedName || 'sRGB IEC61966-2.1' }
    const { applyDocumentColorDecision } = await import('./engine/documentColor')
    const conversion = {
      intent: preferences.colorIntent,
      blackPointCompensation: preferences.colorBlackPoint,
      dither: preferences.colorDither,
    }
    if (color.status === 'missing') {
      if (preferences.colorMissingPolicy === 'ask') return null
      if (preferences.colorMissingPolicy === 'leave')
        return { document: next, summary: 'без профиля' }
      if (color.mode === 'grayscale') {
        const assigned = builtinColorProfile(preferences.colorGrayProfile) as ColorProfileModel
        return {
          document: await applyDocumentColorDecision(next, {
            action: 'assign-and-convert',
            assigned,
            ...conversion,
          }),
          summary: `${assigned.name} → sRGB`,
        }
      }
      return {
        document: await applyDocumentColorDecision(next, { action: 'assign-working' }),
        summary: 'назначен sRGB IEC61966-2.1',
      }
    }

    if (preferences.colorMismatchPolicy === 'ask') return null
    if (preferences.colorMismatchPolicy === 'assign-working')
      return {
        document: await applyDocumentColorDecision(next, {
          action: 'assign-working',
          sourceLabel: color.embeddedName,
        }),
        summary: 'назначен sRGB без преобразования',
      }
    if (
      preferences.colorMismatchPolicy === 'convert' &&
      color.status === 'mismatch' &&
      color.sourceModel
    )
      return {
        document: await applyDocumentColorDecision(next, {
          action: 'convert',
          source: color.sourceModel,
          ...conversion,
        }),
        summary: `${color.embeddedName || 'ICC'} → sRGB`,
      }
    return {
      document: await applyDocumentColorDecision(next, {
        action: 'discard',
        sourceLabel: color.embeddedName,
      }),
      summary:
        color.status === 'mismatch'
          ? 'встроенный профиль отброшен'
          : 'неподдерживаемый профиль отброшен',
    }
  }

  const finishPendingColorImport = async (choice: PsdColorProfileChoice) => {
    if (!pendingDocument || !pendingColorImport || colorProfileBusy) return
    setColorProfileBusy(true)
    setBusy('Применяем цветовой профиль PSD…')
    try {
      if (choice.rememberMismatch || choice.rememberMissing)
        setPreferences((current) => ({
          ...current,
          ...(choice.rememberMismatch ? { colorMismatchPolicy: choice.rememberMismatch } : {}),
          ...(choice.rememberMissing ? { colorMissingPolicy: choice.rememberMissing } : {}),
        }))
      const { applyDocumentColorDecision } = await import('./engine/documentColor')
      const next = await applyDocumentColorDecision(pendingDocument, choice.decision)
      const label =
        choice.decision.action === 'convert' || choice.decision.action === 'assign-and-convert'
          ? `${choice.decision.source?.name || choice.decision.assigned?.name || 'ICC'} → sRGB`
          : choice.decision.action === 'assign-working'
            ? 'назначен sRGB IEC61966-2.1'
            : 'без профиля'
      await openImportedPsd(next, pendingColorImport.report, label)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Не удалось применить цветовой профиль')
    } finally {
      setColorProfileBusy(false)
      setBusy(null)
    }
  }

  const applyCurrentDocumentProfile = async (decision: DocumentColorDecision) => {
    if (colorProfileBusy) return
    const current = editor.documentRef.current
    setColorProfileBusy(true)
    setBusy('Применяем цветовой профиль документа…')
    try {
      const { applyDocumentColorDecision } = await import('./engine/documentColor')
      const next = await applyDocumentColorDecision(current, decision)
      if (editor.documentRef.current.id !== current.id)
        throw new Error('Документ изменился. Открой профиль заново.')
      await prepareDocument(next)
      editor.change(
        () => next,
        decision.action === 'assign-and-convert'
          ? `Назначение и преобразование профиля: ${decision.assigned?.name || ''}`
          : decision.action === 'assign-working'
            ? 'Назначение рабочего профиля'
            : 'Удаление профиля документа',
      )
      setModal(null)
      toastMessage(`Профиль документа: ${documentColorProfileLabel(next)}`)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Не удалось изменить цветовой профиль')
    } finally {
      setColorProfileBusy(false)
      setBusy(null)
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
    // A brush stroke must not flash a spinner on every commit: the write is
    // debounced, and the "saving" state appears only if the write itself is slow.
    setSaveStatus('pending')
    let slowTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      slowTimer = setTimeout(() => {
        if (saveVersion.current === version) setSaveStatus('saving')
      }, 400)
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
        .finally(() => clearTimeout(slowTimer))
    }, preferences.autosave)
    return () => {
      clearTimeout(timer)
      clearTimeout(slowTimer)
    }
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

  const openCommands = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    editor.finish('Перед поиском команды')
    setModal('commands')
  }
  const maskCommand = async (operation: MaskOperation) => {
    if (!selectedId) return
    const snapshot = editor.documentRef.current
    setBusy('Изменяем маску…')
    try {
      const next = await changeLayerMask(snapshot, selectedId, operation)
      if (editor.documentRef.current === snapshot)
        editor.change(() => next, maskOperationNames[operation])
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Ошибка маски')
    } finally {
      setBusy(null)
    }
  }
  const canFilter =
    !!selected &&
    selected.kind === 'image' &&
    !selected.locked &&
    !settings.editMask &&
    !settings.quickMask &&
    doc.layers.length < MAX_LAYERS
  const openArrange = (ids = selectedId ? [selectedId] : []) => {
    setArrangeIds(ids)
    setModal('arrange')
  }
  const updateLayout = (patch: Partial<DocumentLayout>, label = 'Разметка документа') =>
    editor.change((d) => ({ ...d, layout: normalizeLayout({ ...layoutOf(d), ...patch }) }), label)
  const applySelection = (
    next: Selection,
    mode: SelectionMode = 'replace',
    label = 'Выделение пикселей',
  ) => {
    const result = combineSelection(selection, next, mode, doc.width, doc.height)
    setSelection(result, false, label)
    if (!result.width || !result.height)
      toastMessage('Выделение пустое. Ctrl+Z отменит изменение; Ctrl+D снимет ограничение.')
  }
  const toggleQuickMask = () => {
    setSettings({
      quickMask: !settings.quickMask,
      editMask: false,
      ...(!settings.quickMask ? { color: '#000000', secondaryColor: '#ffffff' } : {}),
    })
    if (!settings.quickMask) setTool('brush')
  }
  const invertSelectedArea = () =>
    setSelection(invertSelection(selection, doc.width, doc.height), false, 'Инверсия выделения')
  const previousSelection = [...editor.entries.slice(0, editor.index + 1)]
    .reverse()
    .find((e) => e.pixelSelection && e.pixelSelection !== selection)?.pixelSelection
  const loadLayerSelection = async (id: string, mode: SelectionMode = 'replace') => {
    const snapshot = editor.documentRef.current
    setBusy('Выделяем непрозрачность слоя…')
    try {
      const c = await selectionSource(snapshot, id),
        rgba = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      const alpha = new Uint8ClampedArray(c.width * c.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
      if (editor.documentRef.current === snapshot)
        applySelection(rasterSelection(alpha, c.width, c.height), mode, 'Выделение из слоя')
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Ошибка выделения')
    } finally {
      setBusy(null)
    }
  }
  const wandSelection = async (point: Point, mode: SelectionMode) => {
    const snapshot = editor.documentRef.current
    setBusy('Выбираем область по цвету…')
    try {
      if (settings.sampleAllLayers === false && !selectedId)
        throw new Error('Выбери слой или включи «Все видимые слои».')
      const c = await selectionSource(
        snapshot,
        settings.sampleAllLayers === false ? selectedId || undefined : undefined,
      )
      const coverage = await runSelection({
        operation: 'wand',
        width: c.width,
        height: c.height,
        pixels: c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data,
        x: point.x,
        y: point.y,
        tolerance: settings.selectionTolerance ?? 32,
        contiguous: settings.contiguous !== false,
      })
      if (editor.documentRef.current === snapshot)
        applySelection(rasterSelection(coverage, c.width, c.height), mode, 'Волшебная палочка')
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Ошибка выделения')
    } finally {
      setBusy(null)
    }
  }
  const addCorrection = (type: CorrectionKind) => {
    try {
      editor.finish('Перед коррекцией')
      const result = insertAdjustment(editor.documentRef.current, type, selectedId, selection)
      setSelection(null, true)
      editor.change(() => result.document, `Коррекция: ${correctionNames[type]}`)
      setSelectedId(result.selectedId)
      setSettings({ editMask: false, quickMask: false })
      setDockTab('properties')
      setTool('move')
      setModal(null)
    } catch (error) {
      toastMessage(error instanceof Error ? error.message : 'Не удалось создать коррекцию')
    }
  }
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
      setSettings({ editMask: true, quickMask: false, color: '#000000', secondaryColor: '#ffffff' })
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
      const mask = {
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
      }
      validateRasterBudget({
        ...doc,
        layers: doc.layers.map((l) => (l.id === id ? { ...l, mask } : l)),
      })
      setSelection(null, true)
      editor.patchLayer(id, { mask }, 'Добавление маски')
      setSelectedId(id)
      setSettings({ editMask: true, quickMask: false, color: '#000000', secondaryColor: '#ffffff' })
      setTool('brush')
    } catch (e) {
      toastMessage(e instanceof Error ? e.message : 'Не удалось создать маску')
    } finally {
      setBusy(null)
    }
  }
  const imageSize = (width: number, height: number, dpi: number, anchor: Point) => {
    const scale = modal === 'image-size',
      sx = width / doc.width,
      sy = height / doc.height,
      dx = (width - doc.width) * anchor.x,
      dy = (height - doc.height) * anchor.y
    if (scale && Math.abs(sx - sy) > 0.00001 && doc.layers.some((l) => l.rotation || l.warp)) {
      toastMessage(
        'Для повёрнутых / перспективных слоёв используй пропорциональный масштаб. Неравномерное изменение исказило бы геометрию.',
      )
      return
    }
    setSelection(null, true)
    editor.change(
      (d) => ({
        ...d,
        width,
        height,
        dpi,
        layout: transformLayout(
          d.layout,
          scale ? sx : 1,
          scale ? sy : 1,
          scale ? 0 : dx,
          scale ? 0 : dy,
        ),
        layers: d.layers.map((l) => ({
          ...l,
          x: l.kind === 'adjustment' ? 0 : scale ? l.x * sx : l.x + dx,
          y: l.kind === 'adjustment' ? 0 : scale ? l.y * sy : l.y + dy,
          width: l.kind === 'adjustment' ? width : scale ? l.width * sx : l.width,
          height: l.kind === 'adjustment' ? height : scale ? l.height * sy : l.height,
          fontSize: l.fontSize && scale ? l.fontSize * sy : l.fontSize,
          textScaleX: scale && l.kind === 'text' ? ((l.textScaleX || 1) * sx) / sy : l.textScaleX,
          letterSpacing: l.letterSpacing && scale ? l.letterSpacing * sy : l.letterSpacing,
          textBaselineShift:
            l.textBaselineShift && scale ? l.textBaselineShift * sy : l.textBaselineShift,
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
      x: clipboardLayer.kind === 'adjustment' ? 0 : clipboardLayer.x + 24,
      y: clipboardLayer.kind === 'adjustment' ? 0 : clipboardLayer.y + 24,
      ...(clipboardLayer.kind === 'adjustment' ? { width: doc.width, height: doc.height } : {}),
      locked: false,
      parentId: undefined,
      sourcePath: undefined,
      styles:
        doc.globalLight && clipboardLayer.styles
          ? synchronizeStylesToGlobalLight(clipboardLayer.styles, doc.globalLight)
          : clipboardLayer.styles,
      mask: clipboardLayer.mask
        ? {
            ...clipboardLayer.mask,
            x: clipboardLayer.mask.x + (clipboardLayer.kind === 'adjustment' ? 0 : 24),
            y: clipboardLayer.mask.y + (clipboardLayer.kind === 'adjustment' ? 0 : 24),
          }
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
    if (selected.kind === 'adjustment')
      return toastMessage('Коррекция зависит от нижнего стека. Используй «Объединить видимые».')
    if (
      selected.kind === 'group' &&
      !selected.isolated &&
      doc.layers.some((l) => subtree(doc, selected.id).has(l.id) && l.kind === 'adjustment')
    )
      return toastMessage(
        'Сначала изолируй группу с коррекциями, чтобы её действие не зависело от нижнего стека.',
      )
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
      const saving = editor.documentRef.current
      const result = await FileManager.save(saving)
      if (result.report)
        setLastExport({ documentId: saving.id, filename: result.filename, report: result.report })
      toastMessage(
        window.fsh777?.saveFile
          ? `Файл сохранён: ${result.filename}`
          : 'PSD подготовлен к скачиванию. Структура — в «Отчёт PSD».',
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
          ? (await import('./engine/atn')).parseAtn(await actionFile.arrayBuffer())
          : parseActionSet(JSON.parse(await actionFile.text()))
        if (actions.length + imported.length > 100)
          throw new Error('До 100 операций в наборе. Удали ненужные перед импортом.')
        setActions((a) => [...a, ...imported])
        setModal('actions')
        toastMessage(`Импортировано операций: ${imported.length}. Проверь поддержку шагов.`)
        return
      }
      const textEntriesFile = files.find((f) => /\.777(?:texts|script)\.json$/i.test(f.name))
      if (textEntriesFile) {
        if (workspace.home) throw new Error('Открой документ перед импортом текстовых блоков')
        if (textEntriesFile.size > 8 * 1024 * 1024)
          throw new Error('Файл текстов должен быть до 8 МиБ')
        const id = editor.documentRef.current.id
        const textEntriesFormat = await import('./engine/textEntriesFormat')
        const imported = textEntriesFormat.parseTextEntriesFile(
          JSON.parse(await textEntriesFile.text()),
        )
        if (editor.documentRef.current.id !== id)
          throw new Error('Документ изменился — повтори импорт текстовых блоков')
        if (
          (editor.documentRef.current.textEntries?.length || 0) + imported.length >
          textEntriesFormat.MAX_TEXT_ENTRIES
        )
          throw new Error('До 200 текстовых блоков')
        editor.change(
          (d) => ({ ...d, textEntries: [...(d.textEntries || []), ...imported] }),
          'Импорт текстовых блоков',
        )
        setInspector(true)
        setDockTab('texts')
        toastMessage(`Добавлено ${imported.length} текстовых блоков без чужих привязок`)
        return
      }
      const layered = files.find((f) => /\.(psd|psb)$/i.test(f.name))
      if (layered) {
        if (layered.size > 80 * 1024 * 1024) throw new Error('PSD/PSB: размер файла до 80 МБ')
        setBusy('Читаем слои PSD/PSB…')
        const { importPsd } = await import('./engine/psd')
        const result = await importPsd(await layered.arrayBuffer(), layered.name)
        const automatic = await automaticPsdColorDecision(result.document, result.report)
        if (!automatic) {
          // Only the colour decision may pause opening. Layer/compatibility
          // details are now a post-open report, never a gate in front of work.
          setPendingDocument(result.document)
          setPendingColorImport({ fileName: layered.name, report: result.report })
          return
        }
        await openImportedPsd(automatic.document, result.report, automatic.summary)
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
    if (target.kind === 'group' || target.kind === 'adjustment' || target.smart)
      return toastMessage('Выбери растровый слой или открой содержимое смарт-объекта')
    if (target.locked) return toastMessage('Сначала разблокируй слой')
    if (operation === 'background' && target.kind !== 'image')
      return toastMessage('Удаление фона работает с изображениями')
    if ((operation === 'erase' || operation === 'fill') && !selection)
      return toastMessage('Сначала выдели область инструментом M')
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
      const rasterTarget = {
        ...target,
        ...rasterizedGeometry(target, buffer),
        flipX: false,
        flipY: false,
      }
      const local = point ? localPoint(rasterTarget, point) : undefined
      if (
        local &&
        (local.x < 0 ||
          local.y < 0 ||
          local.x >= rasterTarget.width ||
          local.y >= rasterTarget.height)
      )
        throw new Error('Кликни внутри выбранного слоя')
      const sx = buffer.width / rasterTarget.width,
        sy = buffer.height / rasterTarget.height
      let rect: Selection | undefined
      if (selection && (operation === 'erase' || operation === 'fill'))
        rect = { x: 0, y: 0, width: buffer.width, height: buffer.height }
      const pixels = await runPixelOperation({
        operation,
        width: buffer.width,
        height: buffer.height,
        pixels: ctx.getImageData(0, 0, buffer.width, buffer.height).data,
        mask: selection
          ? selectionMask(selection, buffer.width, buffer.height, rasterTarget)
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
  const openRepair = (area: Selection | null = selection) => {
    if (!area || area.width < 1 || area.height < 1)
      return toastMessage('Обведи область инструментом J или создай выделение.')
    if (!doc.layers.length) return toastMessage('Сначала открой документ или добавь изображение.')
    setSelection(area)
    setModal('repair')
  }
  const crop = () => {
    if (!selection || selection.width < 1 || selection.height < 1) return
    const x = Math.round(selection.x),
      y = Math.round(selection.y),
      width = Math.max(1, Math.round(selection.width)),
      height = Math.max(1, Math.round(selection.height))
    setSelection(null, true)
    editor.change(
      (d) => ({
        ...d,
        width,
        height,
        layout: transformLayout(d.layout, 1, 1, -x, -y),
        layers: d.layers.map((l) => ({
          ...l,
          x: l.kind === 'adjustment' ? 0 : l.x - x,
          y: l.kind === 'adjustment' ? 0 : l.y - y,
          ...(l.kind === 'adjustment' ? { width, height } : {}),
          mask: l.mask ? { ...l.mask, x: l.mask.x - x, y: l.mask.y - y } : undefined,
        })),
      }),
      'Кадрирование холста',
    )
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
      if (e.defaultPrevented) return
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
      if (
        (e.ctrlKey || e.metaKey) &&
        e.altKey &&
        e.code === 'KeyR' &&
        !busy &&
        !modal &&
        !pendingDocument &&
        !workspace.closing &&
        !workspace.home
      ) {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
        if (recorder.recording) stopActionRecording()
        else {
          editor.finish('Перед записью')
          setModal('actions')
        }
        return
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        e.code === 'KeyF' &&
        !busy &&
        !modal &&
        !pendingDocument &&
        !workspace.closing
      ) {
        e.preventDefault()
        openCommands()
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
          !e.altKey &&
          a.shortcut?.key === e.code &&
          a.shortcut.shift === e.shiftKey &&
          a.shortcut.ctrl === mod,
      )
      if (action) {
        e.preventDefault()
        executeAction(action)
        return
      }
      if (mod) {
        switch (e.code) {
          case 'Semicolon':
            e.preventDefault()
            updateLayout(e.shiftKey ? { snap: !layout.snap } : { showGuides: !layout.showGuides })
            return
          case 'Quote':
            e.preventDefault()
            updateLayout({ showGrid: !layout.showGrid })
            return
          case 'KeyR':
            e.preventDefault()
            setRulers(!rulers)
            return
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
          case 'KeyF':
            if (e.altKey && canFilter && lastFilter) {
              e.preventDefault()
              setModal('raster-filter')
            }
            return
          case 'KeyI':
            e.preventDefault()
            if (e.shiftKey || settings.quickMask) {
              invertSelectedArea()
              return
            }
            if (settings.editMask && selected?.mask) {
              void maskCommand('invert')
              return
            }
            if (selected && !selected.locked && selected.kind !== 'adjustment')
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
          case 'KeyL':
            e.preventDefault()
            addCorrection('levels')
            return
          case 'KeyM':
            e.preventDefault()
            addCorrection('curves')
            return
          case 'KeyU':
            if (!e.shiftKey) {
              e.preventDefault()
              addCorrection('hue/saturation')
              return
            }
            if (
              e.shiftKey &&
              selected &&
              !selected.locked &&
              selected.kind !== 'adjustment' &&
              !settings.quickMask
            ) {
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
            if (e.shiftKey && previousSelection) setSelection(previousSelection)
            else setSelection(null)
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
      if (
        e.key.startsWith('Arrow') &&
        selected &&
        !selected.locked &&
        selected.kind !== 'adjustment' &&
        !settings.quickMask
      ) {
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
      if (e.code === 'KeyQ') {
        e.preventDefault()
        toggleQuickMask()
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
        const saving = editor.documentRef.current
        void FileManager.save(saving, false, true)
          .then((r) => {
            if (r.report)
              setLastExport({ documentId: saving.id, filename: r.filename, report: r.report })
            toastMessage(
              window.fsh777?.saveFile ? `Файл сохранён: ${r.filename}` : 'PSD готов к скачиванию',
            )
          })
          .catch((e) => toastMessage(e.message))
          .finally(() => setBusy(null))
      },
    },
    {
      label: 'Отчёт последнего PSD',
      icon: Save,
      disabled: lastExport?.documentId !== doc.id,
      action: () => setModal('psd-report'),
    },
    {
      label: 'Отчёт импорта PSD',
      icon: Palette,
      disabled: lastImportReport?.documentId !== doc.id,
      action: () => setModal('import-report'),
    },
    { label: 'Резервная копия (старый .777)', icon: Save, action: () => void saveBackup() },
    {
      label: 'Экспорт изображения…',
      icon: Download,
      shortcut: 'Ctrl ⇧ S',
      action: () => setModal('export'),
    },
    {
      label: 'Пакетная обработка…',
      icon: Layers3,
      action: () => setModal('batch'),
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
      label: 'Цветовой профиль документа…',
      icon: Palette,
      action: () => setModal('document-profile'),
      divider: true,
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
    {
      label: 'Линейки',
      checked: rulers,
      action: () => setRulers(!rulers),
      divider: true,
      shortcut: 'Ctrl R',
    },
    { label: 'Направляющие и сетка…', action: () => setModal('guides') },
    {
      label: 'Показать направляющие',
      checked: layout.showGuides,
      action: () => updateLayout({ showGuides: !layout.showGuides }),
      shortcut: 'Ctrl ;',
    },
    {
      label: 'Заблокировать направляющие',
      checked: layout.locked,
      action: () => updateLayout({ locked: !layout.locked }),
    },
    {
      label: 'Показать сетку',
      checked: layout.showGrid,
      action: () => updateLayout({ showGrid: !layout.showGrid }),
      shortcut: "Ctrl '",
    },
    {
      label: 'Привязка',
      checked: layout.snap,
      action: () => updateLayout({ snap: !layout.snap }),
      shortcut: 'Ctrl ⇧ ;',
    },
    {
      label: 'Удалить все направляющие',
      action: () => updateLayout({ guides: [] }, 'Удаление направляющих'),
      disabled: layout.locked || !layout.guides.length,
    },
    {
      label: 'Подсказки привязки',
      checked: settings.showGuides,
      action: () => setSettings({ showGuides: !settings.showGuides }),
    },
    { label: 'Панель свойств и слоёв', checked: inspector, action: () => setInspector(!inspector) },
  ]
  const correctionMenu: MenuItem[] = Object.entries(correctionNames).map(([type, label]) => ({
    label,
    action: () => addCorrection(type as CorrectionKind),
    disabled: !!busy || doc.layers.length >= MAX_LAYERS,
  }))
  correctionMenu.push({
    label: 'Экспорт цветового стека CUBE…',
    action: () => setModal('export-lut'),
    divider: true,
  })
  const layerMenu: MenuItem[] = [
    ...Object.entries(maskOperationNames).map(([operation, label]) => ({
      label,
      action: () => void maskCommand(operation as MaskOperation),
      disabled: !selected?.mask || !!selected.locked,
    })),
    {
      label: 'Выравнивание и интервалы…',
      action: () => openArrange(),
      disabled: !doc.layers.length,
    },
    {
      label: 'Новый корректирующий слой…',
      icon: SlidersHorizontal,
      action: () => setModal('correction'),
    },
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
      disabled: !selected || selected.locked || !!selected.smart || selected.kind === 'adjustment',
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
      disabled: !selected || selected.locked || selected.kind === 'adjustment',
      divider: true,
    },
    {
      label: 'Глобальный свет…',
      icon: Sun,
      action: () => setModal('global-light'),
    },
    {
      label: 'Градиент инструмента…',
      icon: Blend,
      action: () => {
        setTool('gradient')
        setModal('gradient-tool')
      },
    },
    {
      label: 'Растрировать содержимое',
      icon: ImagePlus,
      action: () => void rasterizeSelected(),
      disabled: !selected || selected.locked || selected.kind === 'adjustment',
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
  const selectionMenu: MenuItem[] = [
    {
      label: 'Выделить всё',
      shortcut: 'Ctrl A',
      action: () => setSelection({ x: 0, y: 0, width: doc.width, height: doc.height }),
    },
    {
      label: 'Снять выделение',
      shortcut: 'Ctrl D',
      action: () => setSelection(null),
      disabled: !selection,
    },
    {
      label: 'Выделить повторно',
      shortcut: 'Ctrl ⇧ D',
      action: () => previousSelection && setSelection(previousSelection),
      disabled: !previousSelection,
    },
    { label: 'Инвертировать выделение', shortcut: 'Ctrl ⇧ I', action: invertSelectedArea },
    { label: 'Цветовой диапазон…', action: () => setModal('color-range'), divider: true },
    {
      label: 'Из непрозрачности слоя',
      action: () => selectedId && void loadLayerSelection(selectedId),
      disabled: !selected || selected.kind === 'adjustment',
    },
    ...Object.entries(selectionModifyNames).map(([kind, label]) => ({
      label: `${label} выделение…`,
      action: () => {
        setSelectionModify(kind as SelectionModify)
        setModal('selection-modify')
      },
      disabled: !selection,
      divider: kind === 'expand',
    })),
    {
      label: 'Быстрая маска',
      shortcut: 'Q',
      checked: !!settings.quickMask,
      action: toggleQuickMask,
      divider: true,
    },
  ]
  const pathMenu: MenuItem[] = [
    { label: 'Рисовать пером', shortcut: 'P', action: () => setTool('pen') },
    {
      label: 'Редактировать узлы',
      shortcut: 'A',
      action: pathController.activate,
      disabled: !pathController.editable || selected?.locked,
    },
    {
      label: 'Преобразовать фигуру в контур',
      action: pathController.convert,
      disabled: !pathController.editable || selected?.shape === 'path' || selected?.locked,
    },
    {
      label: 'Контур в выделение',
      shortcut: 'Ctrl Enter',
      action: () => pathController.toSelection(),
      disabled: !pathController.editable || selected?.locked,
    },
    {
      label: 'Гладкие узлы',
      action: () => pathController.mode('smooth'),
      disabled: !pathController.nodes.length || selected?.locked,
    },
    {
      label: 'Угловые узлы',
      action: () => pathController.mode('corner'),
      disabled: !pathController.nodes.length || selected?.locked,
    },
    {
      label: 'Соединить концы',
      action: pathController.join,
      disabled: pathController.nodes.length !== 2 || selected?.locked,
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
      action: invertSelectedArea,
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
    {
      label: 'Растровые фильтры на копии…',
      action: () => setModal('raster-filter'),
      disabled: !canFilter,
    },
    {
      label: 'Пластика на копии…',
      action: () => setModal('liquify'),
      disabled: !canFilter,
    },
    {
      label: 'Частотное разложение…',
      action: () => setModal('frequency'),
      disabled: !canFilter,
    },
    {
      label: 'Последний растровый фильтр…',
      shortcut: 'Ctrl Alt F',
      action: () => setModal('raster-filter'),
      disabled: !canFilter || !lastFilter,
    },
    {
      label: 'Восстановление области…',
      shortcut: 'J',
      action: () => openRepair(),
      disabled: !selection,
    },
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
      disabled:
        !selected || selected.locked || selected.kind === 'group' || selected.kind === 'adjustment',
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
    {
      label: 'Текстовые блоки',
      checked: inspector && dockTab === 'texts',
      action: () => {
        setInspector(true)
        setDockTab('texts')
      },
    },
    {
      label: 'Панель операций',
      checked: inspector && dockTab === 'actions',
      action: () => {
        setInspector(true)
        setDockTab('actions')
      },
    },
    ...(
      [
        ['texts', 'Текстовые блоки'],
        ['properties', 'Свойства'],
        ['standard', 'Стандартная'],
      ] as const
    ).map(([id, name]) => ({
      label: `Рабочая среда: ${name}`,
      checked: panelLayout.preset === id,
      action: () => {
        setPanelLayout(panelPreset(id))
        setInspector(true)
      },
    })),
    {
      label: panelLayout.floating ? 'Закрепить панели' : 'Открепить панели',
      action: () => {
        setPanelLayout((p) => ({ ...p, floating: !p.floating, preset: 'custom' }))
        setInspector(true)
      },
    },
    {
      label: 'Сбросить рабочую среду',
      action: () => {
        setPanelLayout(panelPreset('standard'))
        setInspector(true)
      },
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
    { label: 'Поиск команд…', icon: Search, shortcut: 'Ctrl F', action: openCommands },
    { label: 'Библиотека шрифтов…', icon: Type, action: () => setModal('fonts') },
    { label: 'Горячие клавиши', icon: Keyboard, shortcut: '?', action: () => setModal('help') },
    { label: 'О ФШ777 ULTRA', icon: Sparkles, action: () => setModal('about') },
  ]

  const homeCommands = new Set([
    'Новый проект',
    'Пакетная обработка…',
    'Открыть файл…',
    'Главная / недавние',
    'Открыть демопроект',
    'Настройки…',
    'Библиотека шрифтов…',
    'Горячие клавиши',
    'О ФШ777 ULTRA',
  ])
  const commands: EditorCommand[] = (
    [
      ['Файл', fileMenu],
      ['Правка', editMenu],
      ['Изображение', imageMenu],
      ['Слой', layerMenu],
      ['Контур', pathMenu],
      ['Коррекция', correctionMenu],
      ['Выделение', selectionMenu],
      ['Вид', viewMenu],
      ['Фильтры', filterMenu],
      ['Окно', windowMenu],
      ['Помощь', helpMenu],
    ] as [string, MenuItem[]][]
  ).flatMap(([group, items]) =>
    items
      .filter((item) => item.label !== 'Поиск команд…')
      .map((item) => ({
        id: `${group}:${item.label}`,
        label: item.label,
        group,
        shortcut: item.shortcut,
        disabled: !!busy || item.disabled || (workspace.home && !homeCommands.has(item.label)),
        run: item.action,
      })),
  )
  commands.push(
    ...tools.map((t) => ({
      id: `tool:${t.id}`,
      label: t.name,
      group: 'Инструменты',
      shortcut: t.key,
      disabled: !!busy || workspace.home,
      run: () => setTool(t.id),
    })),
  )
  commands.push(
    ...actions.map((a) => ({
      id: `action:${a.id}`,
      label: a.name,
      group: 'Операции',
      keywords: a.source,
      disabled: !!busy || workspace.home || !selected || !!selected.locked,
      run: () => executeAction(a),
    })),
  )

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
            aria-label="О редакторе ФШ777 ULTRA"
          >
            <span className="brand-mark">
              <BrandMark size={32} />
            </span>
            <span className="brand-name">
              ФШ <b>777</b>
            </span>
            <span className="ultra-badge">ULTRA</span>
          </button>
          <nav className="main-menu" aria-label="Меню редактора">
            <Dropdown label="Файл" items={fileMenu} />
            <Dropdown label="Правка" items={editMenu} />
            <Dropdown label="Изображение" items={imageMenu} />
            <Dropdown label="Слой" items={layerMenu} />
            <Dropdown label="Контур" items={pathMenu} />
            <Dropdown label="Коррекция" items={correctionMenu} />
            <Dropdown label="Выделение" items={selectionMenu} />
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
                  : saveStatus === 'pending'
                    ? 'Автокопия'
                    : 'Скачай проект для сохранения'}
            </span>
          </div>
          <div className="header-actions">
            <IconButton
              icon={Search}
              label="Поиск команд (Ctrl+F)"
              onClick={openCommands}
              disabled={!!busy}
            />
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
            {[
              'brush',
              'pen',
              'rectangle',
              'ellipse',
              'polygon',
              'star',
              'line',
              'text',
              'bucket',
              'gradient',
              'eyedropper',
            ].includes(tool) && (
              <div className="tool-color-pair" role="group" aria-label="Цвета инструмента">
                <div className="tool-color-swatches">
                  <label className="option-color background" title="Фоновый цвет">
                    <input
                      type="color"
                      aria-label="Фоновый цвет инструмента"
                      value={settings.secondaryColor}
                      onChange={(e) => setSettings({ secondaryColor: e.target.value })}
                    />
                    <span style={{ background: settings.secondaryColor }} />
                  </label>
                  <label
                    className="option-color foreground"
                    title="Основной цвет — им рисует кисть. Alt+клик по холсту возьмёт цвет из изображения"
                  >
                    <input
                      type="color"
                      aria-label="Цвет инструмента"
                      value={settings.color}
                      onChange={(e) => setSettings({ color: e.target.value })}
                    />
                    <span style={{ background: settings.color }} />
                  </label>
                </div>
                <span className="tool-color-hex">{settings.color.toUpperCase()}</span>
                <button
                  className="swap-colors-top"
                  title="Поменять цвета (X)"
                  aria-label="Поменять основной и фоновый цвета"
                  onClick={() =>
                    setSettings({ color: settings.secondaryColor, secondaryColor: settings.color })
                  }
                >
                  <ArrowLeftRight size={12} />
                </button>
              </div>
            )}
            {selectionTools.includes(tool) && (
              <Select
                aria-label="Режим выделения"
                value={settings.selectionMode || 'replace'}
                onChange={(e) => setSettings({ selectionMode: e.target.value as SelectionMode })}
              >
                {Object.entries(selectionModeNames).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
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
                    checked={layout.snap}
                    onChange={(e) => updateLayout({ snap: e.target.checked })}
                  />
                  Привязка
                </label>
              </>
            ) : tool === 'brush' || tool === 'eraser' || tool === 'clone' ? (
              <>
                <SliderField
                  label="Размер"
                  value={settings.brushSize}
                  min={1}
                  max={500}
                  suffix="px"
                  onChange={(brushSize) => setSettings({ brushSize })}
                />
                <SliderField
                  label="Непр."
                  value={settings.brushOpacity}
                  min={1}
                  max={100}
                  suffix="%"
                  onChange={(brushOpacity) => setSettings({ brushOpacity })}
                />
                <SliderField
                  label="Жёсткость"
                  value={settings.brushHardness ?? 100}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(brushHardness) => setSettings({ brushHardness })}
                />
                <SliderField
                  label="Интервал"
                  value={settings.brushSpacing || 15}
                  min={5}
                  max={100}
                  suffix="%"
                  onChange={(brushSpacing) => setSettings({ brushSpacing })}
                />
                {tool === 'clone' ? (
                  <span className="tool-instruction">Alt+клик — источник · текущий слой</span>
                ) : tool === 'brush' ? (
                  <span className="tool-instruction">Alt+клик — взять цвет с холста</span>
                ) : null}
              </>
            ) : isRetouchTool(tool) ? (
              <>
                <SliderField
                  label="Размер"
                  value={settings.brushSize}
                  min={1}
                  max={500}
                  suffix="px"
                  onChange={(brushSize) => setSettings({ brushSize })}
                />
                <SliderField
                  label="Жёсткость"
                  value={settings.brushHardness ?? 100}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(brushHardness) => setSettings({ brushHardness })}
                />
                <SliderField
                  label={tool === 'dodge' || tool === 'burn' ? 'Экспозиция' : 'Сила'}
                  value={settings.retouchStrength ?? 30}
                  min={1}
                  max={100}
                  suffix="%"
                  onChange={(retouchStrength) => setSettings({ retouchStrength })}
                />
                {(tool === 'dodge' || tool === 'burn') && (
                  <Select
                    aria-label="Диапазон тонов"
                    value={settings.retouchRange || 'midtones'}
                    onChange={(e) =>
                      setSettings({
                        retouchRange: e.target.value as 'shadows' | 'midtones' | 'highlights',
                      })
                    }
                  >
                    <option value="shadows">Тени</option>
                    <option value="midtones">Средние тона</option>
                    <option value="highlights">Света</option>
                  </Select>
                )}
                {tool === 'sponge' && (
                  <Select
                    aria-label="Режим губки"
                    value={settings.spongeMode || 'desaturate'}
                    onChange={(e) =>
                      setSettings({ spongeMode: e.target.value as 'saturate' | 'desaturate' })
                    }
                  >
                    <option value="desaturate">Обесцветить</option>
                    <option value="saturate">Насытить</option>
                  </Select>
                )}
                <span className="tool-instruction">По пикселям текущего растрового слоя</span>
              </>
            ) : tool === 'magic-wand' ? (
              <>
                <SliderField
                  label="Допуск палочки"
                  value={settings.selectionTolerance ?? 32}
                  min={0}
                  max={255}
                  onChange={(selectionTolerance) => setSettings({ selectionTolerance })}
                />
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.contiguous !== false}
                    onChange={(e) => setSettings({ contiguous: e.target.checked })}
                  />
                  Смежные пиксели
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.sampleAllLayers !== false}
                    onChange={(e) => setSettings({ sampleAllLayers: e.target.checked })}
                  />
                  Все видимые слои
                </label>
              </>
            ) : tool === 'wand' || tool === 'bucket' ? (
              <>
                <SliderField
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
                <SliderField
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
                    : 'Shift: + · Alt: − · Shift+Alt: пересечение · Ctrl+D: снять'}
                </span>
              </>
            ) : tool === 'repair-brush' ? (
              <>
                <SliderField
                  label="Размер"
                  value={settings.brushSize}
                  min={1}
                  max={500}
                  suffix="px"
                  onChange={(brushSize) => setSettings({ brushSize })}
                />
                <SliderField
                  label="Жёсткость"
                  value={settings.brushHardness ?? 100}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(brushHardness) => setSettings({ brushHardness })}
                />
                <span className="tool-instruction">
                  Закрась объект целиком и отпусти — сначала покажем результат · Alt убирает лишнее
                </span>
              </>
            ) : tool === 'pen' ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.shapeFill}
                  onChange={(e) => setSettings({ shapeFill: e.target.checked })}
                />
                Заливка замкнутого контура
              </label>
            ) : ['node', 'add-anchor', 'delete-anchor', 'convert-anchor'].includes(tool) ? (
              <span className="tool-instruction">
                Перо P · узлы A · Shift: несколько · параметры справа
              </span>
            ) : tool === 'gradient' ? (
              <>
                <button
                  className="gradient-tool-strip"
                  aria-label="Выбрать градиент"
                  title="Выбрать или изменить градиент"
                  style={{
                    background: gradientCss(
                      settings.gradient ||
                        solidGradient([
                          { position: 0, color: settings.color },
                          { position: 1, color: settings.secondaryColor },
                        ]),
                      90,
                      24,
                    ),
                  }}
                  onClick={() => setModal('gradient-tool')}
                />
                <Select
                  aria-label="Тип градиента"
                  value={settings.gradientType || 'linear'}
                  onChange={(e) =>
                    setSettings({
                      gradientType: e.target.value as 'linear' | 'radial' | 'reflected' | 'angle',
                    })
                  }
                >
                  <option value="linear">Линейный</option>
                  <option value="radial">Радиальный</option>
                  <option value="reflected">Отражённый</option>
                  <option value="angle">Угловой</option>
                </Select>
              </>
            ) : (
              <span className="tool-instruction">
                {tool === 'repair' || tool === 'repair-box'
                  ? 'Выдели область → предпросмотр → отдельный слой · Shift+J меняет подтип'
                  : tool === 'text-frame'
                    ? 'Протяни текстовую рамку · параметры в панели справа'
                    : tool === 'text'
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
        {recorder.recording && (
          <RecordingBar
            recording={recorder.recording}
            storageError={recorder.storageError}
            onPause={recorder.pause}
            onResume={() => {
              try {
                recorder.resume()
              } catch (e) {
                toastMessage(e instanceof Error ? e.message : 'Ошибка продолжения')
              }
            }}
            onStop={stopActionRecording}
            onCancel={recorder.cancel}
          />
        )}
        <div
          className={`editor-body ${panelLayout.side === 'left' && !panelLayout.floating ? 'panels-on-left' : ''}`}
        >
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
                      <span className="document-unsaved">
                        {saveStatus === 'saving' || saveStatus === 'pending' ? '•' : ''}
                      </span>
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
                pathController={pathController}
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
                onWand={(point, mode) => void wandSelection(point, mode)}
                onGuideSettings={() => setModal('guides')}
                onCrop={crop}
                onRepair={openRepair}
                onEditText={() => {
                  setInspector(true)
                  setDockTab('properties')
                }}
                onPixelAction={(op, point) => void pixelAction(op, point)}
                onToast={toastMessage}
                onBusy={setBusy}
                smooth={preferences.smooth}
                showPerformance={preferences.showPerformance}
                rulers={rulers}
                busy={!!busy || !!modal || !!pendingDocument || !!workspace.closing}
                onOpenSmart={(id) => void workspace.openSmart(id)}
              />
            )}
            <footer className="workspace-status">
              <span className="status-left">
                <span className="status-dot" />
                {doc.width} × {doc.height} px · {doc.layers.length} слоёв · RGB/8 ·{' '}
                <button
                  className="status-profile-button"
                  onClick={() => setModal('document-profile')}
                  title="Цветовой профиль документа"
                >
                  {documentColorProfileLabel(doc)}
                </button>
                <span className="status-divider" />
                {selected ? selected.name : 'Холст'}
              </span>
              {lastImportReport?.documentId === doc.id && (
                <button className="psd-report-button" onClick={() => setModal('import-report')}>
                  Отчёт импорта
                </button>
              )}
              {lastExport?.documentId === doc.id && (
                <button className="psd-report-button" onClick={() => setModal('psd-report')}>
                  Отчёт PSD
                </button>
              )}
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
            <PanelDock
              value={panelLayout}
              onChange={setPanelLayout}
              properties={
                <PropertiesPanel
                  pathController={pathController}
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
                  onMaskCommand={(operation) => void maskCommand(operation)}
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
                  busy={!!busy || !!modal || !!pendingDocument || !!workspace.closing}
                />
              }
              texts={
                <Suspense fallback={null}>
                  <TextEntriesPanel
                    key={doc.id}
                    editor={editor}
                    selection={selection}
                    busy={!!busy || !!modal || !!pendingDocument || !!workspace.closing}
                    onToast={toastMessage}
                    onDraw={() => {
                      setTool('text-frame')
                      toastMessage('Протяни рамку на холсте. Затем размести в ней текстовый блок.')
                    }}
                  />
                </Suspense>
              }
              actions={
                <ActionsPanel
                  actions={actions}
                  onRun={executeAction}
                  onManage={() => setModal('actions')}
                  onRecord={startActionRecording}
                  canRun={
                    !!selected &&
                    !selected.locked &&
                    !busy &&
                    !modal &&
                    !pendingDocument &&
                    !workspace.closing
                  }
                  recording={!!recorder.recording}
                />
              }
              layers={
                <LayersPanel
                  onCorrection={() => setModal('correction')}
                  onArrange={openArrange}
                  onLoadSelection={(id, mode) => void loadLayerSelection(id, mode)}
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
                  onStyle={(id) => {
                    setSelectedId(id)
                    setModal('styles')
                  }}
                  editingMask={!!settings.editMask}
                  onPixels={() => setSettings({ editMask: false })}
                />
              }
              footer={
                <div className="inspector-footer">
                  <ShieldCheck size={12} />
                  <span>Твои файлы остаются у тебя</span>
                  <span className="footer-777">777</span>
                </div>
              }
            />
          )}
        </div>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,.777,.fsh777,.psd,.psb,.atn,.777actions.json,.777texts.json,.777script.json"
        multiple
        aria-label="Открыть изображение или проект"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files || []))
          e.target.value = ''
        }}
      />
      <Suspense fallback={dialogFallback}>
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
        {modal === 'repair' && selection && (
          <RepairDialog
            doc={doc}
            selection={selection}
            onClose={closeModal}
            onApply={(layer, belowText) => {
              if (doc.layers.length >= MAX_LAYERS) throw new Error('В документе уже 100 слоёв')
              validateRasterBudget({ ...doc, layers: [...doc.layers, layer] })
              editor.change(
                (d) => insertRepairLayer(d, layer, belowText),
                'Восстановление области · новый слой',
              )
              setSelectedId(layer.id)
              closeModal()
              toastMessage(
                'Результат на отдельном слое. Исходные пиксели сохранены; Ctrl+Z отменяет изменение.',
              )
            }}
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
              if (
                selected &&
                !selected.locked &&
                ['shape', 'text'].includes(selected.kind) &&
                !settings.quickMask &&
                !settings.editMask
              )
                editor.patchLayer(selected.id, { color }, 'Цвет слоя')
              closeModal()
            }}
          />
        )}
        {modal === 'actions' && (
          <ActionsDialog
            actions={actions}
            storageError={actionsError}
            recording={!!recorder.recording}
            onRecord={startActionRecording}
            onUpdate={(action) =>
              setActions((a) => a.map((v) => (v.id === action.id ? action : v)))
            }
            onClose={closeModal}
            onImport={() => input.current?.click()}
            onRun={executeAction}
            onCapture={captureAction}
            onDelete={(id) => setActions((a) => a.filter((v) => v.id !== id))}
            canRun={!!selected && !selected.locked && !workspace.home}
          />
        )}
        {modal === 'batch' && (
          <BatchDialog actions={actions} onClose={closeModal} onToast={toastMessage} />
        )}
        {modal === 'gradient-tool' && (
          <GradientToolDialog
            gradient={settings.gradient}
            color={settings.color}
            secondaryColor={settings.secondaryColor}
            onChange={(gradient) => setSettings({ gradient })}
            onClose={closeModal}
          />
        )}
        {modal === 'styles' && selected && (
          <LayerStyleDialog
            layer={selected}
            globalLight={effectiveGlobalLight(doc)}
            hasExplicitGlobalLight={!!doc.globalLight}
            onClose={closeModal}
            onApply={(styles, blendIf, globalLight) => {
              if (globalLight) {
                const nextLight = normalizeGlobalLight(globalLight)
                editor.change((current) => {
                  if (isLayerLocked(current, selected.id)) return current
                  const withStyle = {
                    ...current,
                    layers: current.layers.map((layer) =>
                      layer.id === selected.id ? { ...layer, styles, blendIf } : layer,
                    ),
                  }
                  return synchronizeDocumentGlobalLight(withStyle, nextLight)
                }, 'Стиль слоя и глобальный свет')
              } else editor.patchLayer(selected.id, { styles, blendIf }, 'Стиль слоя')
              closeModal()
            }}
          />
        )}
        {modal === 'global-light' && (
          <GlobalLightDialog
            value={effectiveGlobalLight(doc)}
            explicit={!!doc.globalLight}
            linkedCount={countLinkedGlobalLightEffects(doc, true)}
            onClose={closeModal}
            onApply={(globalLight) => {
              editor.change(
                (current) => synchronizeDocumentGlobalLight(current, globalLight),
                'Глобальный свет',
              )
              closeModal()
            }}
          />
        )}
        {modal === 'export-lut' && (
          <ExportLutDialog
            doc={doc}
            onClose={closeModal}
            onSaved={(name) => toastMessage(`Цветовая таблица сохранена: ${name}`)}
          />
        )}
        {modal === 'psd-report' && lastExport && (
          <PsdReportDialog
            report={lastExport.report}
            filename={lastExport.filename}
            onClose={closeModal}
          />
        )}
        {modal === 'import-report' && lastImportReport?.documentId === doc.id && (
          <ImportReportDialog report={lastImportReport.report} onClose={closeModal} />
        )}
        {modal === 'document-profile' && (
          <DocumentProfileDialog
            doc={doc}
            preferences={preferences}
            busy={colorProfileBusy}
            onClose={closeModal}
            onApply={(decision) => void applyCurrentDocumentProfile(decision)}
          />
        )}
        {pendingDocument && pendingColorImport && (
          <PsdColorProfileDialog
            fileName={pendingColorImport.fileName}
            report={pendingColorImport.report.color}
            preferences={preferences}
            busy={colorProfileBusy}
            onCancel={() => {
              setPendingDocument(null)
              setPendingColorImport(null)
              toastMessage('PSD не открыт: выбор цветового профиля отменён')
            }}
            onApply={(choice) => void finishPendingColorImport(choice)}
          />
        )}
        {pendingDocument && !pendingColorImport && (
          <ReplaceDialog
            name={pendingDocument.name}
            onClose={closeReplace}
            onSave={() => void saveProject()}
            onConfirm={() => openDocument(pendingDocument)}
          />
        )}
        {modal === 'commands' && <CommandPalette commands={commands} onClose={closeModal} />}
        {modal === 'raster-filter' && selectedId && (
          <RasterFilterDialog
            doc={doc}
            id={selectedId}
            selection={selection}
            initial={lastFilter || defaultRasterFilter('unsharp')}
            onClose={closeModal}
            onApply={(copy, filter, hide) => {
              if (editor.documentRef.current !== doc)
                throw new Error('Документ изменился. Открой фильтр заново.')
              const next = insertFilteredCopy(doc, selectedId, copy, hide)
              editor.change(() => next, 'Фильтр на растровой копии')
              setSelectedId(copy.id)
              setLastFilter(filter)
              setSettings({ editMask: false, quickMask: false })
              setTool('move')
              closeModal()
            }}
          />
        )}
        {modal === 'liquify' && selectedId && (
          <LiquifyDialog
            doc={doc}
            id={selectedId}
            selection={selection}
            onClose={closeModal}
            onApply={(copy, hide) => {
              if (editor.documentRef.current !== doc)
                throw new Error('Документ изменился. Открой пластику заново.')
              const next = insertFilteredCopy(doc, selectedId, copy, hide)
              editor.change(() => next, 'Пластика на растровой копии')
              setSelectedId(copy.id)
              setSettings({ editMask: false, quickMask: false })
              setTool('move')
              closeModal()
            }}
          />
        )}
        {modal === 'frequency' && selectedId && (
          <FrequencyDialog
            doc={doc}
            id={selectedId}
            selection={selection}
            onClose={closeModal}
            onApply={(low, high, hide) => {
              if (editor.documentRef.current !== doc)
                throw new Error('Документ изменился. Открой разложение заново.')
              const withLow = insertFilteredCopy(doc, selectedId, low, hide)
              const next = insertFilteredCopy(withLow, low.id, high, false)
              editor.change(() => next, 'Частотное разложение')
              setSelectedId(high.id)
              setSettings({ editMask: false, quickMask: false })
              setTool('move')
              closeModal()
            }}
          />
        )}
        {modal === 'arrange' && (
          <ArrangeDialog
            doc={doc}
            ids={arrangeIds}
            onClose={closeModal}
            onApply={(next, label) => {
              if (editor.documentRef.current !== doc)
                throw new Error('Документ изменился во время компоновки. Открой окно заново.')
              editor.change(() => next, label)
              closeModal()
            }}
          />
        )}
        {modal === 'guides' && (
          <GuidesDialog
            doc={doc}
            onClose={closeModal}
            onApply={(value) => {
              updateLayout(value, 'Настройка направляющих и сетки')
              closeModal()
            }}
          />
        )}
        {modal === 'color-range' && (
          <ColorRangeDialog
            doc={doc}
            initialMode={settings.selectionMode || 'replace'}
            onApply={(area, mode) => {
              applySelection(area, mode, 'Цветовой диапазон')
              closeModal()
            }}
            onClose={closeModal}
          />
        )}
        {modal === 'selection-modify' && selection && (
          <SelectionModifyDialog
            selection={selection}
            width={doc.width}
            height={doc.height}
            initial={selectionModify}
            onApply={(area, kind) => {
              setSelection(area, false, `${selectionModifyNames[kind]} выделение`)
              closeModal()
            }}
            onClose={closeModal}
          />
        )}
        {modal === 'correction' && <CorrectionDialog onAdd={addCorrection} onClose={closeModal} />}
      </Suspense>
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
          <BrandMark size={48} />
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
