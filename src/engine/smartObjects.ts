import { newDocument, uid, makeLayer } from './document'
import { subtree } from './layerOperations'
import {
  encodeBitmap,
  exportCanvas,
  prepareDocument,
  rasterizeLayer,
  rasterizedGeometry,
  validateRasterBudget,
} from './render'
import { pixelBounds, rasterBounds } from './layerGeometry'
import { DEFAULT_ADJUSTMENTS, type EditorDocument, type Layer } from '../types'
export async function makeSmartObject(doc: EditorDocument, id: string) {
  const selected = doc.layers.find((l) => l.id === id)
  if (!selected || selected.locked || selected.smart)
    throw new Error('Выбери незаблокированный обычный слой или группу')
  if (selected.kind === 'adjustment')
    throw new Error(
      'Добавь коррекцию и её основу в изолированную группу перед созданием смарт-объекта.',
    )
  if (
    selected.kind === 'group' &&
    !selected.isolated &&
    doc.layers.some((l) => subtree(doc, id).has(l.id) && l.kind === 'adjustment')
  )
    throw new Error(
      'Сначала изолируй группу с коррекциями, чтобы сохранить действие на нижний стек.',
    )
  await prepareDocument(doc)
  let inner: EditorDocument
  let bitmap: Layer
  if (selected.kind === 'group') {
    const ids = subtree(doc, id)
    inner = {
      ...doc,
      id: uid(),
      name: selected.name,
      background: 'transparent',
      layers: doc.layers
        .filter((l) => ids.has(l.id))
        .map((l) =>
          l.id === id ? { ...l, parentId: undefined, visible: true, locked: false } : l,
        ),
    }
    bitmap = await encodeBitmap(makeLayer({ kind: 'image' }), await exportCanvas(inner))
  } else {
    const bounds = pixelBounds(
      selected.kind === 'text' || selected.kind === 'shape'
        ? rasterBounds(selected, false, true)
        : { x: 0, y: 0, width: selected.width, height: selected.height },
    )
    if (bounds.width > 4096 || bounds.height > 4096)
      throw new Error('Сначала уменьши слой до 4096 px по каждой стороне')
    inner = newDocument(bounds.width, bounds.height, selected.name, 'transparent')
    inner.dpi = doc.dpi
    inner.layers = [
      {
        ...selected,
        id: uid(),
        x: -bounds.x,
        y: -bounds.y,
        rotation: 0,
        warp: undefined,
        // The editable child retains flips; the outer bitmap has them baked, like
        // explicit rasterization, with rebased placement/warp/mask/style geometry.
        parentId: undefined,
        mask: undefined,
        styles: undefined,
        opacity: 1,
        blendMode: 'source-over',
        visible: true,
        locked: false,
        sourcePath: undefined,
      },
    ]
    const base = await rasterizeLayer(selected)
    // Use the content document as canonical preview, just like Apply. The temporary
    // raster supplies placement/warp/mask/style rebasing, not the editable contents.
    bitmap = await encodeBitmap(
      {
        ...selected,
        ...rasterizedGeometry(selected, base),
        flipX: false,
        flipY: false,
        adjustments: { ...DEFAULT_ADJUSTMENTS },
      },
      await exportCanvas(inner),
    )
  }
  const depth = (value: EditorDocument): number =>
    Math.max(0, ...value.layers.map((l) => (l.smart ? 1 + depth(l.smart) : 0)))
  if (depth(inner) > 2) throw new Error('Вложенность смарт-объектов ограничена тремя уровнями')
  const outer =
    selected.kind === 'group'
      ? makeLayer({
          id: selected.id,
          kind: 'image',
          name: selected.name,
          src: bitmap.src,
          smart: inner,
          x: 0,
          y: 0,
          width: doc.width,
          height: doc.height,
          parentId: selected.parentId,
          visible: selected.visible,
        })
      : {
          ...bitmap,
          smart: inner,
          sourcePath: undefined,
        }
  const ids = subtree(doc, id),
    result = {
      ...doc,
      layers: doc.layers
        .filter((l) => !ids.has(l.id) || l.id === id)
        .map((l) => (l.id === id ? outer : l)),
    }
  validateRasterBudget(result)
  return result
}
