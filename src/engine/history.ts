import type { EditorDocument, HistoryEntry, Selection } from '../types'
export interface DocumentCommand {
  label: string
  execute(): EditorDocument
  undo(): EditorDocument
}
/** Immutable commands share unchanged pixel strings; a complete drag is one command. */
export class ReplaceDocumentCommand implements DocumentCommand {
  constructor(
    readonly before: EditorDocument,
    readonly after: EditorDocument,
    readonly label: string,
  ) {}
  execute() {
    return this.after
  }
  undo() {
    return this.before
  }
}
export function trimHistory(entries: HistoryEntry[], limit = 50, byteLimit = 128 * 1024 * 1024) {
  const keep = entries.slice(-Math.max(2, Math.min(101, limit + 1)))
  const size = () => {
    const sources = new Set<string>()
    let bytes = 0
    const buffers = new Set<ArrayBufferLike>()
    const collect = (doc: EditorDocument) => {
      for (const entry of doc.script || [])
        for (const value of [entry.source, entry.translation, entry.note])
          if (!sources.has(value)) {
            sources.add(value)
            bytes += value.length * 2
          }
      for (const layer of doc.layers) {
        for (const src of [layer.src, layer.mask?.src, layer.text, layer.sourceText])
          if (src && !sources.has(src)) {
            sources.add(src)
            bytes += src.length * 2
          }
        if (layer.smart) collect(layer.smart)
      }
    }
    for (const entry of keep) {
      collect(entry.document)
      const data = entry.pixelSelection?.raster?.data
      if (data && !buffers.has(data.buffer)) {
        buffers.add(data.buffer)
        bytes += data.byteLength
      }
    }
    return bytes
  }
  while (keep.length > 2 && size() > byteLimit) keep.shift()
  if (keep.length) keep[0] = { ...keep[0], command: undefined }
  return keep
}
/** A global target, in addition to each tab's undo budget. Keep every current
 * document; only inactive undo stacks may be discarded, never artwork. */
export function trimInactiveHistories<
  T extends {
    document: EditorDocument
    entries: HistoryEntry[]
    index: number
    pixelSelection?: Selection | null
  },
>(sessions: Map<string, T>, activeId: string, target = 256 * 1024 * 1024) {
  const strings = new Set<string>()
  const buffers = new Set<ArrayBufferLike>()
  let selectionBytes = 0
  const collectSelection = (s?: Selection | null) => {
    const data = s?.raster?.data
    if (data && !buffers.has(data.buffer)) {
      buffers.add(data.buffer)
      selectionBytes += data.byteLength
    }
  }
  const collect = (doc: EditorDocument) => {
    for (const entry of doc.script || [])
      for (const value of [entry.source, entry.translation, entry.note]) strings.add(value)
    for (const layer of doc.layers) {
      if (layer.text) strings.add(layer.text)
      if (layer.sourceText) strings.add(layer.sourceText)
      if (layer.src) strings.add(layer.src)
      if (layer.mask?.src) strings.add(layer.mask.src)
      if (layer.smart) collect(layer.smart)
    }
  }
  for (const session of sessions.values()) {
    collect(session.document)
    collectSelection(session.pixelSelection)
    for (const entry of session.entries) {
      collect(entry.document)
      collectSelection(entry.pixelSelection)
    }
  }
  let bytes = selectionBytes
  for (const source of strings) bytes += source.length * 2
  if (bytes <= target) return false
  let changed = false
  for (const [id, session] of sessions)
    if (id !== activeId && session.entries.length > 1) {
      const current = session.entries[session.index]
      sessions.set(id, {
        ...session,
        entries: [{ ...current, document: session.document, command: undefined }],
        index: 0,
      })
      changed = true
    }
  return changed
}

/** Structural equality only at the END of a gesture, short-circuiting shared
 * immutable subtrees. No visual-field exclusions: names, guides and smart data
 * still count as real changes. Missing and undefined serialize equivalently. */
export function sameProjectData(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true
  if (depth > 64 || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => sameProjectData(v, b[i], depth + 1))
    )
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null)
    return false
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>
  for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
    if (!sameProjectData(x[key], y[key], depth + 1)) return false
  return true
}
