import { descendants, isLayerLocked, makeLayer, uid } from './document'
import { hasStyles } from './styles'
import { MAX_LAYERS, type EditorDocument, type Layer } from '../types'
export const subtree = (doc: EditorDocument, id: string) => new Set([id, ...descendants(doc, id)])
export function visibleLayerRows(doc: EditorDocument) {
  const rows: { layer: Layer; depth: number }[] = []
  const visit = (parentId?: string, depth = 0) => {
    if (depth > 12) return
    for (const layer of doc.layers.filter((l) => l.parentId === parentId).reverse()) {
      rows.push({ layer, depth })
      if (layer.kind === 'group' && layer.expanded !== false) visit(layer.id, depth + 1)
    }
  }
  visit()
  return rows
}
export function duplicateLayers(doc: EditorDocument, id: string, offset = 24) {
  const root = doc.layers.find((l) => l.id === id)
  if (!root) throw new Error('Слой не найден')
  const all = subtree(doc, id),
    source = doc.layers.filter((l) => all.has(l.id))
  if (doc.layers.length + source.length > MAX_LAYERS)
    throw new Error('В проекте доступно до 100 слоёв, включая содержимое групп')
  const ids = new Map(source.map((l) => [l.id, uid()]))
  const copies = source.map((l) => ({
    ...l,
    id: ids.get(l.id)!,
    // A duplicate is never the document's Photoshop Background layer.
    background: undefined,
    parentId: l.parentId ? ids.get(l.parentId) || l.parentId : undefined,
    name: l.id === id ? `${l.name} — копия` : l.name,
    x: l.x + (l.kind === 'adjustment' ? 0 : offset),
    y: l.y + (l.kind === 'adjustment' ? 0 : offset),
    locked: l.id === id ? false : l.locked,
    mask: l.mask
      ? {
          ...l.mask,
          x: l.mask.x + (l.kind === 'adjustment' ? 0 : offset),
          y: l.mask.y + (l.kind === 'adjustment' ? 0 : offset),
        }
      : undefined,
  }))
  const at = Math.max(...source.map((l) => doc.layers.indexOf(l))) + 1
  return {
    document: { ...doc, layers: [...doc.layers.slice(0, at), ...copies, ...doc.layers.slice(at)] },
    selectedId: ids.get(id)!,
  }
}
export function deleteLayers(doc: EditorDocument, id: string) {
  const root = doc.layers.find((l) => l.id === id)
  if (!root || isLayerLocked(doc, id)) return doc
  const all = subtree(doc, id)
  return { ...doc, layers: doc.layers.filter((l) => !all.has(l.id)) }
}
export function groupLayers(doc: EditorDocument, ids: string[]) {
  if (doc.layers.length >= MAX_LAYERS) throw new Error('Достигнут лимит 100 слоёв')
  const selected = doc.layers.filter(
    (l) => ids.includes(l.id) && !ids.some((id) => id !== l.id && descendants(doc, id).has(l.id)),
  )
  const parentId = selected[0]?.parentId
  if (selected.some((l) => l.parentId !== parentId))
    throw new Error('Группируй слои одного уровня иерархии')
  let depth = 0,
    parent = parentId
  while (parent) {
    depth++
    parent = doc.layers.find((l) => l.id === parent)?.parentId
  }
  if (depth >= 11) throw new Error('Вложенность групп ограничена 12 уровнями')
  const group = makeLayer({
    kind: 'group',
    name: 'Группа',
    width: doc.width,
    height: doc.height,
    parentId,
    expanded: true,
    isolated: false,
  })
  const target = new Set(selected.map((l) => l.id)),
    layers = doc.layers.map((l) => (target.has(l.id) ? { ...l, parentId: group.id } : l))
  const at = selected.length
    ? Math.max(...selected.map((l) => doc.layers.indexOf(l))) + 1
    : layers.length
  layers.splice(at, 0, group)
  return { document: { ...doc, layers }, selectedId: group.id }
}
export function ungroupLayers(doc: EditorDocument, id: string) {
  const group = doc.layers.find((l) => l.id === id)
  if (!group || isLayerLocked(doc, id) || group.kind !== 'group' || group.locked) return doc
  if (
    group.opacity !== 1 ||
    group.blendMode !== 'source-over' ||
    group.mask?.enabled ||
    hasStyles(group.styles) ||
    group.isolated ||
    Object.values(group.adjustments).some((v) => v)
  )
    throw new Error(
      'Эта группа меняет общий результат наложения. Сначала убери её маску/эффекты/изоляцию или растрируй, чтобы не потерять внешний вид.',
    )
  const nested = subtree(doc, id),
    ordered = doc.layers
      .filter((l) => nested.has(l.id) && l.id !== id)
      .map((l) =>
        l.parentId === id
          ? { ...l, parentId: group.parentId, visible: l.visible && group.visible }
          : l,
      )
  const after = doc.layers.filter((l) => !nested.has(l.id)),
    at = doc.layers.slice(0, doc.layers.indexOf(group)).filter((l) => !nested.has(l.id)).length
  after.splice(at, 0, ...ordered)
  return { ...doc, layers: after }
}
export function moveLayer(
  doc: EditorDocument,
  id: string,
  target: string | number,
  parentOverride?: string | null,
) {
  const layer = doc.layers.find((l) => l.id === id)
  if (!layer || isLayerLocked(doc, id)) return doc
  const all = subtree(doc, id),
    moving = doc.layers.filter((l) => all.has(l.id)),
    remaining = doc.layers.filter((l) => !all.has(l.id))
  let parentId = layer.parentId,
    at: number
  if (parentOverride !== undefined) {
    if (
      parentOverride &&
      (all.has(parentOverride) || doc.layers.find((l) => l.id === parentOverride)?.kind !== 'group')
    )
      throw new Error('Нельзя переместить группу внутрь самой себя')
    parentId = parentOverride || undefined
    at = remaining.length
  } else if (typeof target === 'number') {
    const siblings = doc.layers.filter((l) => l.parentId === layer.parentId),
      i = siblings.indexOf(layer),
      other = siblings[i + target]
    if (!other) return doc
    const otherTree = subtree(doc, other.id),
      positions = remaining.flatMap((l, i) => (otherTree.has(l.id) ? [i] : []))
    at = target > 0 ? Math.max(...positions) + 1 : Math.min(...positions)
  } else {
    const other = doc.layers.find((l) => l.id === target)
    if (!other || all.has(other.id)) return doc
    parentId = other.kind === 'group' ? other.id : other.parentId
    at = remaining.indexOf(other) + 1
  }
  if (parentId && all.has(parentId)) throw new Error('Циклическая группа недопустима')
  let parent = parentId,
    depth = 0
  while (parent) {
    if (++depth > 10) throw new Error('Слишком глубокая иерархия')
    const p = doc.layers.find((l) => l.id === parent)
    if (p?.locked) throw new Error('Сначала разблокируй родительскую группу')
    parent = p?.parentId
  }
  return {
    ...doc,
    layers: [
      ...remaining.slice(0, at),
      ...moving.map((l) => (l.id === id ? { ...l, parentId } : l)),
      ...remaining.slice(at),
    ],
  }
}
