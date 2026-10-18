import type { EditorDocument, Layer } from '../types'
/** An explicit manga mode: preserve only the trailing root-level type stack above the repair.
 * Groups and clipping chains stay intact. Sampling and placement use the same boundary so preview is not misleading. */
export function repairPlacement(doc: EditorDocument, belowText: boolean) {
  const roots = doc.layers.filter((l) => !l.parentId),
    skip = new Set<string>()
  if (belowText) {
    let start = roots.length
    while (start > 0 && roots[start - 1].kind === 'text') start--
    // A clipped text at the bottom depends on a base outside the type stack. Do not insert
    // a new base between them. A following un-clipped text can begin a safe trailing stack.
    while (start < roots.length && roots[start].clipping) start++
    for (let i = start; i < roots.length; i++) skip.add(roots[i].id)
  }
  const index = skip.size ? doc.layers.findIndex((l) => skip.has(l.id)) : doc.layers.length
  return {
    index,
    source: skip.size ? { ...doc, layers: doc.layers.filter((l) => !skip.has(l.id)) } : doc,
  }
}
export function insertRepairLayer(doc: EditorDocument, layer: Layer, belowText: boolean) {
  const { index } = repairPlacement(doc, belowText)
  return { ...doc, layers: [...doc.layers.slice(0, index), layer, ...doc.layers.slice(index)] }
}
