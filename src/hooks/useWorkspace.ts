import { useRef, useState } from 'react'
import type { Editor, EditorSession } from './useEditor'
import type { EditorDocument } from '../types'
import { parseProject, uid } from '../engine/document'
import { encodeBitmap, exportCanvas, prepareDocument } from '../engine/render'
import { forgetRecent, loadDocument, recentProjects, saveDocument, type RecentProject } from '../engine/storage'
export interface DocumentTab { id: string; name: string; parent?: { tabId: string; layerId: string } }
/** Independent documents keep independent command stacks. Nothing is silently replaced when opening a file. */
export function useWorkspace(editor: Editor, onBusy: (s: string | null) => void, onToast: (s: string) => void, onSwitch: () => void) {
  const [home, setHome] = useState(true), [tabs, setTabs] = useState<DocumentTab[]>([]), [recents, setRecents] = useState<RecentProject[]>([]), [recovery, setRecovery] = useState<EditorDocument | null>(null), [closing, setClosing] = useState<string | null>(null)
  const sessions = useRef(new Map<string, EditorSession>())
  const capture = () => { const snapshot = editor.snapshot(); if (tabs.some(t => t.id === snapshot.document.id)) { sessions.current.set(snapshot.document.id, snapshot); void saveDocument(snapshot.document, undefined, false).catch(() => onToast('Не записана автокопия вкладки. Сохрани PSD на диск.')) } return snapshot }
  const initialize = async () => { try { const [current, recent] = await Promise.all([loadDocument(), recentProjects()]); setRecovery(current); setRecents(recent) } catch { onToast('Локальное хранилище недоступно. Сохраняй PSD на диск.') } }
  const persist = async (doc: EditorDocument, current = false) => {
    let thumbnail: string | undefined
    try { thumbnail = (await exportCanvas(doc, Math.min(1, 320 / doc.width, 190 / doc.height))).toDataURL('image/webp', .72) } catch { /* A missing preview must not prevent recovery. */ }
    await saveDocument(doc, thumbnail, current)
  }
  const open = (value: EditorDocument, parent?: DocumentTab['parent']) => {
    if (tabs.length >= 6) { onToast('Одновременно открыто до 6 документов. Закрой ненужную вкладку.'); return false }
    capture(); const doc = tabs.some(t => t.id === value.id) ? { ...value, id: uid() } : value
    editor.reset(doc); sessions.current.set(doc.id, editor.snapshot()); setTabs(t => [...t, { id: doc.id, name: doc.name, parent }]); setHome(false); onSwitch(); return true
  }
  const switchTo = async (id: string) => {
    if (id === editor.documentRef.current.id) { setHome(false); return }
    capture(); const snapshot = sessions.current.get(id); if (!snapshot) return
    onBusy('Открываем вкладку…')
    try { await prepareDocument(snapshot.document); editor.restore(snapshot); setHome(false); onSwitch() } catch (e) { onToast(e instanceof Error ? e.message : 'Не удалось открыть вкладку') } finally { onBusy(null) }
  }
  const openRecent = async (recent: RecentProject | EditorDocument) => {
    const value = 'document' in recent ? recent.document : recent
    if (tabs.some(t => t.id === value.id)) { await switchTo(value.id); return }
    onBusy('Восстанавливаем проект…')
    try { const doc = parseProject(value); await prepareDocument(doc); if (open(doc)) setRecovery(null) } catch (e) { onToast(e instanceof Error ? e.message : 'Повреждена локальная копия') } finally { onBusy(null) }
  }
  const showHome = async () => {
    const snapshot = capture(); setHome(true)
    if (tabs.length) try { await persist(snapshot.document, true); setRecents(await recentProjects()) } catch { onToast('Копия не записана: сохрани PSD перед закрытием приложения.') }
  }
  const forget = async (id: string) => { try { await forgetRecent(id); setRecents(await recentProjects()); if (recovery?.id === id) setRecovery(null) } catch { onToast('Не удалось изменить список недавних') } }
  const requestClose = (id: string) => { if (tabs.some(t => t.parent?.tabId === id)) { onToast('Сначала примени или закрой вкладку содержимого смарт-объекта.'); return } setClosing(id) }
  const close = async () => {
    const id = closing; if (!id) return
    capture(); const snapshot = sessions.current.get(id)
    if (!snapshot) { setClosing(null); return }
    onBusy('Сохраняем локальную копию…')
    try {
      await persist(snapshot.document); const remaining = tabs.filter(t => t.id !== id)
      if (editor.documentRef.current.id === id && remaining.length) { const next = sessions.current.get(remaining.at(-1)!.id)!; await prepareDocument(next.document); editor.restore(next); onSwitch() }
      if (!remaining.length) setHome(true)
      setTabs(remaining); sessions.current.delete(id); setClosing(null); setRecents(await recentProjects())
    } catch { onToast('Локальная копия не сохранена. Вкладка оставлена открытой — сохрани PSD на диск.') } finally { onBusy(null) }
  }
  const openSmart = async (layerId: string) => {
    const layer = editor.documentRef.current.layers.find(l => l.id === layerId); if (!layer?.smart) return
    const parent = { tabId: editor.documentRef.current.id, layerId }, existing = tabs.find(t => t.parent?.tabId === parent.tabId && t.parent.layerId === layerId)
    if (existing) { await switchTo(existing.id); return }
    onBusy('Открываем содержимое смарт-объекта…')
    try { await prepareDocument(layer.smart); open({ ...layer.smart, name: `${layer.name} — содержимое` }, parent) } catch (e) { onToast(e instanceof Error ? e.message : 'Не удалось открыть смарт-объект') } finally { onBusy(null) }
  }
  const applySmart = async () => {
    const current = editor.documentRef.current, tab = tabs.find(t => t.id === current.id), parent = tab?.parent
    if (!parent) return
    capture(); const snapshot = sessions.current.get(parent.tabId), layer = snapshot?.document.layers.find(l => l.id === parent.layerId)
    if (!snapshot || !layer) { onToast('Родительский слой был удалён. Содержимое можно сохранить отдельным PSD.'); return }
    if (layer.locked) { onToast('Сначала разблокируй родительский смарт-объект.'); return }
    onBusy('Обновляем смарт-объект…')
    try {
      const bitmap = await encodeBitmap(layer, await exportCanvas(current))
      editor.restore(snapshot); editor.patchLayer(layer.id, { src: bitmap.src, smart: current }, 'Обновление смарт-объекта'); sessions.current.set(parent.tabId, editor.snapshot()); setHome(false); setClosing(null); onSwitch(); onToast('Содержимое обновлено. Ctrl+Z в родительском документе отменяет замену.')
    } catch (e) { onToast(e instanceof Error ? e.message : 'Не удалось обновить смарт-объект') } finally { onBusy(null) }
  }
  return { home, tabs, recents, recovery, closing, setClosing, initialize, open, switchTo, showHome, openRecent, forget, requestClose, close, openSmart, applySmart, resume: () => setHome(false), closingDocument: closing === editor.document.id ? editor.document : closing ? sessions.current.get(closing)?.document : undefined, activeTab: tabs.find(t => t.id === editor.document.id) }
}
