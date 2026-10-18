import { loadPreferences } from '../engine/preferences'
import { useCallback, useRef, useState } from 'react'
import type { EditorDocument, HistoryEntry, Layer } from '../types'
import { descendants } from '../engine/document'
import { ReplaceDocumentCommand, trimHistory } from '../engine/history'
import { pruneImageCache } from '../engine/render'

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
    const history = trimHistory([...entriesRef.current.slice(0, indexRef.current + 1), { document: next, label, time: Date.now(), command: new ReplaceDocumentCommand(entriesRef.current[indexRef.current].document, next, label), selectedId: next.layers.some(l => l.id === selectionRef.current) ? selectionRef.current : null }], loadPreferences().history)
    entriesRef.current = history; indexRef.current = history.length - 1
    setEntries(history); setIndex(history.length - 1)
    pruneImageCache(history.map(e => e.document))
  }, [])
  const change = useCallback((fn: (doc: EditorDocument) => EditorDocument, label: string, temporary = false) => {
    const next = fn(documentRef.current)
    const command = new ReplaceDocumentCommand(documentRef.current, next, label)
    const result = command.execute()
    if (!temporary) record(result, command.label)
    setCurrent(result)
  }, [record, setCurrent])
  const patchLayer = useCallback((id: string, patch: Partial<Layer>, label = 'Изменение слоя', temporary = false) => {
    change(d => {
      const target = d.layers.find(l => l.id === id); if (!target) return d
      const children = target.kind === 'group' ? descendants(d, id) : new Set<string>()
      const dx = (patch.x ?? target.x) - target.x, dy = (patch.y ?? target.y) - target.y
      return { ...d, layers: d.layers.map(l => {
        const next = l.id === id ? { ...l, ...patch } : children.has(l.id) && (dx || dy) ? { ...l, x: l.x + dx, y: l.y + dy } : l
        if (next !== l && l.mask?.linked && !(l.id === id && 'mask' in patch)) {
          const sx = next.width / l.width, sy = next.height / l.height
          return { ...next, mask: { ...l.mask, x: next.x + (l.mask.x - l.x) * sx, y: next.y + (l.mask.y - l.y) * sy, width: l.mask.width * sx, height: l.mask.height * sy } }
        }
        return next
      }) }
    }, label, temporary)
  }, [change])
  const finish = useCallback((label: string) => record(documentRef.current, label), [record])
  const travel = useCallback((to: number) => {
    if (to < 0 || to >= entriesRef.current.length) return
    const current = indexRef.current
    const next = to === current - 1 ? entriesRef.current[current].command?.undo() : to === current + 1 ? entriesRef.current[to].command?.execute() : undefined
    indexRef.current = to; setIndex(to); setCurrent(next || entriesRef.current[to].document)
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
