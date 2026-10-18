import { newDocument, uid, makeLayer } from './document'
import { subtree } from './layerOperations'
import { encodeBitmap, exportCanvas, validateRasterBudget } from './render'
import { DEFAULT_ADJUSTMENTS, type EditorDocument } from '../types'
export async function makeSmartObject(doc: EditorDocument, id: string) {
  const selected = doc.layers.find(l => l.id === id)
  if (!selected || selected.locked || selected.smart) throw new Error('Выбери незаблокированный обычный слой или группу')
  let inner: EditorDocument
  if (selected.kind === 'group') {
    const ids = subtree(doc, id)
    inner = { ...doc, id: uid(), name: selected.name, background: 'transparent', layers: doc.layers.filter(l => ids.has(l.id)).map(l => l.id === id ? { ...l, parentId: undefined, visible: true, locked: false } : l) }
  } else {
    if (selected.width > 4096 || selected.height > 4096) throw new Error('Сначала уменьши слой до 4096 px по каждой стороне')
    inner = newDocument(Math.max(1, Math.ceil(selected.width)), Math.max(1, Math.ceil(selected.height)), selected.name, 'transparent')
    inner.dpi = doc.dpi
    inner.layers = [{ ...selected, id: uid(), x: 0, y: 0, rotation: 0, warp: undefined, flipX: false, flipY: false, parentId: undefined, mask: undefined, styles: undefined, opacity: 1, blendMode: 'source-over', visible: true, locked: false, sourcePath: undefined }]
  }
  const depth = (value: EditorDocument): number => Math.max(0, ...value.layers.map(l => l.smart ? 1 + depth(l.smart) : 0))
  if (depth(inner) > 2) throw new Error('Вложенность смарт-объектов ограничена тремя уровнями')
  const pixels = await exportCanvas(inner)
  const bitmap = await encodeBitmap(makeLayer({ kind: 'image' }), pixels)
  const outer = selected.kind === 'group' ? makeLayer({ id: selected.id, kind: 'image', name: selected.name, src: bitmap.src, smart: inner, x: 0, y: 0, width: doc.width, height: doc.height, parentId: selected.parentId, visible: selected.visible }) : { ...selected, kind: 'image' as const, src: bitmap.src, smart: inner, sourcePath: undefined, adjustments: { ...DEFAULT_ADJUSTMENTS } }
  const ids = subtree(doc, id), result = { ...doc, layers: doc.layers.filter(l => !ids.has(l.id) || l.id === id).map(l => l.id === id ? outer : l) }
  validateRasterBudget(result); return result
}
