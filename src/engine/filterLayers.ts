import type { EditorDocument, Layer, Selection } from '../types'
import { MAX_LAYERS } from '../types'
import { isLayerLocked, uid } from './document'
import { encodeBitmap, loadImage, validateRasterBudget } from './render'
import { selectionMask } from './selection'
import { MAX_FILTER_PIXELS, rasterFilterNames, type RasterFilter } from './rasterFilters'
export interface FilterSource {
  canvas: HTMLCanvasElement
  pixels: Uint8ClampedArray
  mask?: Uint8ClampedArray
  base: Layer
}
export async function prepareFilterSource(
  doc: EditorDocument,
  id: string,
  selection: Selection | null,
): Promise<FilterSource> {
  const layer = doc.layers.find((l) => l.id === id)
  if (!layer || layer.kind !== 'image' || isLayerLocked(doc, id))
    throw new Error(
      'Выбери незаблокированный растровый слой. Текст и фигуры не растрируются автоматически.',
    )
  // Work at the source bitmap resolution. Keep display geometry, flips, live
  // adjustments, masks and FX unchanged; baking them introduces a new sampling grid.
  if (!layer.src) throw new Error('У слоя нет растрового источника.')
  const image = await loadImage(layer.src)
  if (image.width > 4096 || image.height > 4096 || image.width * image.height > MAX_FILTER_PIXELS)
    throw new Error('Растровые фильтры поддерживают до 8 Мп / 4096 px на слой.')
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  const base = layer
  let mask: Uint8ClampedArray | undefined
  if (selection) {
    const data = selectionMask(selection, canvas.width, canvas.height, base, undefined, true)
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height).data
    mask = new Uint8ClampedArray(canvas.width * canvas.height)
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3]
  }
  return {
    canvas,
    pixels: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
    base,
    mask,
  }
}
export function insertFilteredCopy(
  doc: EditorDocument,
  id: string,
  copy: Layer,
  hideOriginal = true,
): EditorDocument {
  const layer = doc.layers.find((l) => l.id === id)
  if (!layer || isLayerLocked(doc, id))
    throw new Error('Исходный слой недоступен или заблокирован.')
  if (doc.layers.length >= MAX_LAYERS)
    throw new Error('Для копии нужен свободный слой: до 100 на документ.')
  const at = doc.layers.indexOf(layer) + 1,
    layers = doc.layers.map((l) => (l.id === id && hideOriginal ? { ...l, visible: false } : l))
  layers.splice(at, 0, { ...copy, parentId: layer.parentId, clipping: layer.clipping })
  const result = { ...doc, layers }
  validateRasterBudget(result)
  return result
}
export async function filteredCopy(
  source: FilterSource,
  pixels: Uint8ClampedArray,
  filter: RasterFilter,
): Promise<Layer> {
  if (pixels.length !== source.canvas.width * source.canvas.height * 4)
    throw new Error('Некорректный результат фильтра')
  const c = document.createElement('canvas')
  c.width = source.canvas.width
  c.height = source.canvas.height
  c.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), c.width, c.height),
    0,
    0,
  )
  const bitmap = await encodeBitmap(
    { ...source.base, flipX: false, flipY: false, mask: undefined },
    c,
  )
  return {
    ...source.base,
    src: bitmap.src,
    kind: 'image',
    id: uid(),
    name: `${source.base.name} · ${rasterFilterNames[filter.type]}`.slice(0, 100),
    visible: true,
    locked: false,
    smart: undefined,
    sourcePath: undefined,
    sourceText: undefined,
    correction: undefined,
  }
}
