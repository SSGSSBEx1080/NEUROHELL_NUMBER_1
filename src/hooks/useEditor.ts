import { useCallback, useRef, useState } from 'react'
import type { EditorDocument, HistoryEntry, Layer } from '../types'
import { pruneImageCache } from '../engine/render'

const HISTORY_LIMIT = 31
export function useEditor(initial: EditorDocument) {
  const initialSelection = initial.layers.find(l => l.kind === 'image')?.id || initial.layers.at(-1)?.id || null
  const [selectedId, setSelectionState] = useState<string | null>(initialSelection)
  const selectionRef = useRef<string | null>(initialSelection)
  const [document, setDocument] = useState(initial)
  const documentRef = useRef(document)
  const [entries, setEntries] = useState<HistoryEntry[]>([{ document: initial, label: 'Открытие проекта', time: Date.now(), selectedId: initialSelection }])
  const entriesRef = useRef(entries)
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const setSelectedId = useCallback((id: string | null) => {
    selectionRef.current = id; setSelectionState(id)
    const current = entriesRef.current[indexRef.current]
    if (current.document === documentRef.current) current.selectedId = id
  }, [])
  const setCurrent = useCallback((next: EditorDocument) => { documentRef.current = next; setDocument(next) }, [])
  const record = useCallback((next: EditorDocument, label: string) => {
    if (entriesRef.current[indexRef.current].document === next) return
    const history = [...entriesRef.current.slice(0, indexRef.current + 1), { document: next, label, time: Date.now(), selectedId: next.layers.some(l => l.id === selectionRef.current) ? selectionRef.current : null }].slice(-HISTORY_LIMIT)
    entriesRef.current = history; indexRef.current = history.length - 1
    setEntries(history); setIndex(history.length - 1)
    pruneImageCache(history.map(e => e.document))
  }, [])
  const change = useCallback((fn: (doc: EditorDocument) => EditorDocument, label: string, temporary = false) => {
    const next = fn(documentRef.current)
    if (!temporary) record(next, label)
    setCurrent(next)
  }, [record, setCurrent])
  const patchLayer = useCallback((id: string, patch: Partial<Layer>, label = 'Изменение слоя', temporary = false) => {
    change(d => ({ ...d, layers: d.layers.map(l => l.id === id ? { ...l, ...patch } : l) }), label, temporary)
  }, [change])
  const finish = useCallback((label: string) => record(documentRef.current, label), [record])
  const travel = useCallback((to: number) => {
    if (to < 0 || to >= entriesRef.current.length) return
    indexRef.current = to; setIndex(to); setCurrent(entriesRef.current[to].document)
    selectionRef.current = entriesRef.current[to].selectedId; setSelectionState(selectionRef.current)
  }, [setCurrent])
  const undo = useCallback(() => travel(indexRef.current - 1), [travel])
  const redo = useCallback(() => travel(indexRef.current + 1), [travel])
  const reset = useCallback((doc: EditorDocument) => {
    const selected = doc.layers.find(l => l.kind === 'image')?.id || doc.layers.at(-1)?.id || null
    selectionRef.current = selected; setSelectionState(selected)
    const e = [{ document: doc, label: 'Открытие проекта', time: Date.now(), selectedId: selected }]
    entriesRef.current = e; indexRef.current = 0; setEntries(e); setIndex(0); setCurrent(doc)
    pruneImageCache([doc])
  }, [setCurrent])
  return { document, documentRef, selectedId, setSelectedId, change, patchLayer, finish, undo, redo, reset, travel, entries, index, canUndo: index > 0, canRedo: index < entries.length - 1 }
}
export type Editor = ReturnType<typeof useEditor>
