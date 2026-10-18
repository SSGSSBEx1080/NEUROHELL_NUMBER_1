import type { EditorDocument, HistoryEntry } from '../types'
export interface DocumentCommand { label: string; execute(): EditorDocument; undo(): EditorDocument }
/** Immutable commands share unchanged pixel strings; a complete drag is one command. */
export class ReplaceDocumentCommand implements DocumentCommand {
  constructor(readonly before: EditorDocument, readonly after: EditorDocument, readonly label: string) {}
  execute() { return this.after }
  undo() { return this.before }
}
export function trimHistory(entries: HistoryEntry[], limit = 50, byteLimit = 128 * 1024 * 1024) {
  const keep = entries.slice(-Math.max(2, Math.min(101, limit + 1)))
  const size = () => {
    const sources = new Set<string>(); let bytes = 0
    const collect = (doc: EditorDocument) => { for (const layer of doc.layers) { for (const src of [layer.src, layer.mask?.src]) if (src && !sources.has(src)) { sources.add(src); bytes += src.length * 2 } if (layer.smart) collect(layer.smart) } }
    for (const entry of keep) collect(entry.document)
    return bytes
  }
  while (keep.length > 2 && size() > byteLimit) keep.shift()
  if (keep.length) keep[0] = { ...keep[0], command: undefined }
  return keep
}
