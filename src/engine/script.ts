import { isLayerLocked, makeLayer } from './document'
import { textPresets } from './textLayout'
import type { EditorDocument, Rect } from '../types'
import { MAX_LAYERS } from '../types'
/** One immutable transaction: text + link enter history together. A locked linked layer is never bypassed. */
export function typesetEntry(
  doc: EditorDocument,
  entryId: string,
  rect?: Rect | null,
  targetId?: string,
) {
  const entry = doc.script?.find((s) => s.id === entryId)
  if (!entry?.translation.trim()) throw new Error('Сначала введи перевод реплики')
  const id = targetId || entry.layerId,
    target = id ? doc.layers.find((l) => l.id === id) : undefined
  if (target && (target.kind !== 'text' || isLayerLocked(doc, target.id)))
    throw new Error('Выбери незаблокированный текстовый слой')
  if (target && doc.script!.some((e) => e.id !== entryId && e.layerId === target.id))
    throw new Error('Этот слой уже связан с другой репликой')
  if (!target && doc.layers.length >= MAX_LAYERS) throw new Error('В проекте уже 100 слоёв')
  const width = Math.min(doc.width, Math.max(100, doc.width * 0.35)),
    height = Math.min(doc.height, Math.max(60, doc.height * 0.18))
  const bounds =
    rect && rect.width >= 20 && rect.height >= 20
      ? rect
      : { x: (doc.width - width) / 2, y: (doc.height - height) / 2, width, height }
  const layer = target
    ? { ...target, text: entry.translation }
    : makeLayer({
        kind: 'text',
        ...textPresets[0].values,
        ...bounds,
        fontSize: Math.min(40, Math.max(12, bounds.height / 5)),
        name: `Реплика ${doc.script!.indexOf(entry) + 1}${entry.speaker ? ` · ${entry.speaker}` : ''}`,
        text: entry.translation,
      })
  return {
    document: {
      ...doc,
      layers: target
        ? doc.layers.map((l) => (l.id === target.id ? layer : l))
        : [...doc.layers, layer],
      script: doc.script!.map((e) => (e.id === entryId ? { ...e, layerId: layer.id } : e)),
    },
    selectedId: layer.id,
  }
}
