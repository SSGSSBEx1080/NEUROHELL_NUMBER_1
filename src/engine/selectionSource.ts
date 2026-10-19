import type { EditorDocument } from '../types'
import { subtree } from './layerOperations'
import { exportCanvas } from './render'
/** Sample the full visible composite, or one layer/subtree in document coordinates. */
export function selectionSource(doc: EditorDocument, id?: string) {
  if (!id) return exportCanvas(doc)
  const target = doc.layers.find((l) => l.id === id)
  if (!target || target.kind === 'adjustment')
    throw new Error(
      'У коррекции нет собственных пикселей. Включи «Все видимые слои» или выбери другой слой.',
    )
  const ids = subtree(doc, id)
  return exportCanvas({
    ...doc,
    sourceId: undefined,
    background: 'transparent',
    layers: doc.layers
      .filter((l) => ids.has(l.id))
      .map((l) =>
        l.id === id ? { ...l, visible: true, opacity: 1, clipping: false, parentId: undefined } : l,
      ),
  })
}
