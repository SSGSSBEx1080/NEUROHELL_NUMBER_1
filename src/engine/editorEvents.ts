import type { EditorDocument } from '../types'
/** Only committed history changes are published; drag previews are never action steps. */
export type EditorEvent =
  | {
      type: 'commit'
      before: EditorDocument
      after: EditorDocument
      label: string
      selectedId: string | null
    }
  | { type: 'selection'; document: EditorDocument; selectedId: string | null }
  | { type: 'history'; document: EditorDocument; selectedId: string | null }
  | { type: 'document'; document: EditorDocument; selectedId: string | null }
