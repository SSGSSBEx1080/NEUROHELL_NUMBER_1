import type { EditorDocument, Selection } from '../types'
import { MAX_LAYERS } from '../types'
import { correctionNames, defaultCorrection, type CorrectionKind } from './adjustmentTypes'
import { isLayerLocked, makeLayer } from './document'
import { subtree } from './layerOperations'
import { cacheImage, validateRasterBudget } from './render'
import { selectionMask } from './selection'
/** Insert above the active subtree, preserving the active sibling scope. One undo transaction. */
export function insertAdjustment(
  doc: EditorDocument,
  type: CorrectionKind,
  selectedId: string | null,
  selection: Selection | null = null,
) {
  if (doc.layers.length >= MAX_LAYERS) throw new Error('В проекте доступно до 100 слоёв')
  const active = doc.layers.find((l) => l.id === selectedId),
    parentId = active?.parentId
  if (parentId && isLayerLocked(doc, parentId)) throw new Error('Разблокируй родительскую группу')
  const layer = makeLayer({
    kind: 'adjustment',
    name: correctionNames[type],
    correction: defaultCorrection(type),
    width: doc.width,
    height: doc.height,
    parentId,
  })
  if (selection) {
    const c = selectionMask(selection, doc.width, doc.height),
      x = c.getContext('2d')!,
      image = x.getImageData(0, 0, c.width, c.height)
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = image.data[i + 1] = image.data[i + 2] = image.data[i + 3]
      image.data[i + 3] = 255
    }
    x.putImageData(image, 0, 0)
    const src = c.toDataURL('image/png')
    cacheImage(src, c)
    layer.mask = {
      src,
      x: 0,
      y: 0,
      width: doc.width,
      height: doc.height,
      enabled: true,
      linked: true,
      density: 1,
      feather: 0,
      defaultColor: 0,
    }
  }
  const ids = active ? subtree(doc, active.id) : new Set<string>()
  const at = active
    ? Math.max(...doc.layers.flatMap((l, i) => (ids.has(l.id) ? [i] : []))) + 1
    : doc.layers.length
  const next = { ...doc, layers: [...doc.layers.slice(0, at), layer, ...doc.layers.slice(at)] }
  validateRasterBudget(next)
  return { document: next, selectedId: layer.id }
}
