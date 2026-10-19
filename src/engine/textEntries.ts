import { isLayerLocked, makeLayer } from './document'
import { textPresets } from './textLayout'
import type { EditorDocument, Rect } from '../types'
import { MAX_LAYERS } from '../types'
/** One immutable transaction: text + link enter history together. A locked linked layer is never bypassed. */
export function placeTextEntry(
  doc: EditorDocument,
  entryId: string,
  rect?: Rect | null,
  targetId?: string,
) {
  const entry = doc.textEntries?.find((s) => s.id === entryId)
  if (!entry?.text.trim()) throw new Error('Сначала введи содержимое текстового блока')
  const id = targetId || entry.layerId,
    target = id ? doc.layers.find((l) => l.id === id) : undefined
  if (target && (target.kind !== 'text' || isLayerLocked(doc, target.id)))
    throw new Error('Выбери незаблокированный текстовый слой')
  if (target && doc.textEntries!.some((e) => e.id !== entryId && e.layerId === target.id))
    throw new Error('Этот слой уже связан с другим текстовым блоком')
  if (!target && doc.layers.length >= MAX_LAYERS) throw new Error('В проекте уже 100 слоёв')
  const width = Math.min(doc.width, Math.max(100, doc.width * 0.35)),
    height = Math.min(doc.height, Math.max(60, doc.height * 0.18))
  const bounds =
    rect && rect.width >= 20 && rect.height >= 20
      ? rect
      : { x: (doc.width - width) / 2, y: (doc.height - height) / 2, width, height }
  const layer = target
    ? { ...target, text: entry.text }
    : makeLayer({
        kind: 'text',
        ...textPresets[0].values,
        ...bounds,
        fontSize: Math.min(40, Math.max(12, bounds.height / 5)),
        name: `Текстовый блок ${doc.textEntries!.indexOf(entry) + 1}${entry.label ? ` · ${entry.label}` : ''}`,
        text: entry.text,
      })
  return {
    document: {
      ...doc,
      layers: target
        ? doc.layers.map((l) => (l.id === target.id ? layer : l))
        : [...doc.layers, layer],
      textEntries: doc.textEntries!.map((e) =>
        e.id === entryId ? { ...e, layerId: layer.id } : e,
      ),
    },
    selectedId: layer.id,
  }
}
