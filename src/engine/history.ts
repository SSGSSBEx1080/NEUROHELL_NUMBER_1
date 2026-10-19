import type { EditorDocument, HistoryEntry } from '../types'
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
    for (const entry of keep) collect(entry.document)
    return bytes
  }
  while (keep.length > 2 && size() > byteLimit) keep.shift()
  if (keep.length) keep[0] = { ...keep[0], command: undefined }
  return keep
}
/** A global target, in addition to each tab's undo budget. Keep every current
 * document; only inactive undo stacks may be discarded, never artwork. */
export function trimInactiveHistories<
  T extends { document: EditorDocument; entries: HistoryEntry[]; index: number },
>(sessions: Map<string, T>, activeId: string, target = 256 * 1024 * 1024) {
  const strings = new Set<string>()
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
    for (const entry of session.entries) collect(entry.document)
  }
  let bytes = 0
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
