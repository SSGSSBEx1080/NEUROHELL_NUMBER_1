import type { EditorDocument, Layer, Rect } from '../types'
import { descendants, isLayerLocked } from './document'
import { worldBounds } from './layerGeometry'
export type ArrangeMode =
  | 'left'
  | 'center-x'
  | 'right'
  | 'top'
  | 'center-y'
  | 'bottom'
  | 'distribute-x'
  | 'distribute-y'
  | 'gaps-x'
  | 'gaps-y'
export type ArrangeTarget = 'selection' | 'canvas'
export const arrangeNames: Record<ArrangeMode, string> = {
  left: 'По левому краю',
  'center-x': 'По центру горизонтально',
  right: 'По правому краю',
  top: 'По верхнему краю',
  'center-y': 'По центру вертикально',
  bottom: 'По нижнему краю',
  'distribute-x': 'Распределить центры по X',
  'distribute-y': 'Распределить центры по Y',
  'gaps-x': 'Равные интервалы по X',
  'gaps-y': 'Равные интервалы по Y',
}
const union = (bounds: Rect[]): Rect => {
  const x = Math.min(...bounds.map((b) => b.x)),
    y = Math.min(...bounds.map((b) => b.y))
  return {
    x,
    y,
    width: Math.max(...bounds.map((b) => b.x + b.width)) - x,
    height: Math.max(...bounds.map((b) => b.y + b.height)) - y,
  }
}
export function arrangementBounds(doc: EditorDocument, layer: Layer): Rect {
  if (layer.kind === 'adjustment')
    throw new Error('У корректирующего слоя нет собственных границ для выравнивания.')
  if (layer.kind !== 'group') return worldBounds(layer)
  const ids = descendants(doc, layer.id),
    children = doc.layers.filter(
      (l) => ids.has(l.id) && l.kind !== 'group' && l.kind !== 'adjustment',
    )
  if (!children.length) throw new Error('Пустая группа не имеет границ для выравнивания.')
  return union(children.map((l) => worldBounds(l)))
}
/** Parent+child selections move the subtree once. Every precondition is checked before any edit. */
export function arrangeLayers(
  doc: EditorDocument,
  ids: string[],
  mode: ArrangeMode,
  target: ArrangeTarget = 'selection',
): EditorDocument {
  if (!Object.hasOwn(arrangeNames, mode)) throw new Error('Неизвестная операция компоновки')
  const chosen = doc.layers.filter((l) => ids.includes(l.id)),
    roots = chosen.filter(
      (l) => !chosen.some((p) => p.id !== l.id && descendants(doc, p.id).has(l.id)),
    )
  if (!roots.length) throw new Error('Выбери слои для компоновки.')
  const distribute = mode.startsWith('distribute') || mode.startsWith('gaps')
  if (distribute && roots.length < 3)
    throw new Error('Распределение требует не меньше трёх независимых слоёв.')
  if (!distribute && target === 'selection' && roots.length < 2)
    throw new Error('Выбери два слоя или выравнивание относительно холста.')
  for (const l of roots) {
    if (isLayerLocked(doc, l.id)) throw new Error(`Слой «${l.name}» или его группа заблокированы.`)
    if (l.kind === 'group' && doc.layers.some((c) => descendants(doc, l.id).has(c.id) && c.locked))
      throw new Error('Группа содержит заблокированный слой; сначала разблокируй его.')
  }
  const bounds = roots.map((layer) => ({ layer, bounds: arrangementBounds(doc, layer) })),
    outer =
      target === 'canvas'
        ? { x: 0, y: 0, width: doc.width, height: doc.height }
        : union(bounds.map((v) => v.bounds))
  const translations = new Map<string, { x: number; y: number }>()
  if (distribute) {
    const horizontal = mode.endsWith('x'),
      axis = horizontal ? 'x' : 'y',
      dimension = horizontal ? 'width' : 'height',
      center = (b: Rect) => b[axis] + b[dimension] / 2
    const sorted = [...bounds].sort((a, b) =>
      mode.startsWith('gaps')
        ? a.bounds[axis] - b.bounds[axis]
        : center(a.bounds) - center(b.bounds),
    )
    if (mode.startsWith('gaps')) {
      const first = sorted[0].bounds[axis],
        last = Math.max(...sorted.map((v) => v.bounds[axis] + v.bounds[dimension])),
        sum = sorted.reduce((v, item) => v + item.bounds[dimension], 0),
        gap = (last - first - sum) / (sorted.length - 1)
      let cursor = first
      for (const item of sorted) {
        translations.set(item.layer.id, {
          x: horizontal ? cursor - item.bounds[axis] : 0,
          y: horizontal ? 0 : cursor - item.bounds[axis],
        })
        cursor += item.bounds[dimension] + gap
      }
    } else {
      const first = center(sorted[0].bounds),
        step = (center(sorted.at(-1)!.bounds) - first) / (sorted.length - 1)
      sorted.forEach((item, i) =>
        translations.set(item.layer.id, {
          x: horizontal ? first + i * step - center(item.bounds) : 0,
          y: horizontal ? 0 : first + i * step - center(item.bounds),
        }),
      )
    }
  } else
    for (const item of bounds) {
      const b = item.bounds
      translations.set(item.layer.id, {
        x:
          mode === 'left'
            ? outer.x - b.x
            : mode === 'right'
              ? outer.x + outer.width - b.x - b.width
              : mode === 'center-x'
                ? outer.x + outer.width / 2 - b.x - b.width / 2
                : 0,
        y:
          mode === 'top'
            ? outer.y - b.y
            : mode === 'bottom'
              ? outer.y + outer.height - b.y - b.height
              : mode === 'center-y'
                ? outer.y + outer.height / 2 - b.y - b.height / 2
                : 0,
      })
    }
  for (const l of roots)
    for (const child of descendants(doc, l.id)) translations.set(child, translations.get(l.id)!)
  let changed = false
  const layers = doc.layers.map((l) => {
    const d = translations.get(l.id)
    if (!d || Math.abs(d.x) + Math.abs(d.y) < 1e-8) return l
    const x = l.kind === 'adjustment' ? l.x : l.x + d.x,
      y = l.kind === 'adjustment' ? l.y : l.y + d.y
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 16384 || Math.abs(y) > 16384)
      throw new Error('Компоновка выходит за поддерживаемый диапазон координат.')
    changed = true
    return {
      ...l,
      x,
      y,
      mask: l.mask?.linked ? { ...l.mask, x: l.mask.x + d.x, y: l.mask.y + d.y } : l.mask,
    }
  })
  return changed ? { ...doc, layers } : doc
}
