import type { EditorDocument, LayerMask } from '../types'
import { isLayerLocked } from './document'
import { cacheImage, loadImage, validateRasterBudget } from './render'
export type MaskOperation = 'invert' | 'white' | 'black'
export const maskOperationNames: Record<MaskOperation, string> = {
  invert: 'Инвертировать маску',
  white: 'Маска: проявить всё',
  black: 'Маска: скрыть всё',
}
export function transformMaskPixels(pixels: Uint8ClampedArray, operation: MaskOperation) {
  const result = new Uint8ClampedArray(pixels)
  if (!['invert', 'white', 'black'].includes(operation) || pixels.length % 4)
    throw new Error('Некорректная операция маски')
  for (let i = 0; i < result.length; i += 4)
    for (let c = 0; c < 3; c++)
      result[i + c] = operation === 'invert' ? 255 - pixels[i + c] : operation === 'white' ? 255 : 0
  return result
}
/** Update only native mask pixels/default coverage. The text/vector/smart source stays intact. */
export async function changeLayerMask(
  doc: EditorDocument,
  id: string,
  operation: MaskOperation,
): Promise<EditorDocument> {
  if (!Object.hasOwn(maskOperationNames, operation)) throw new Error('Неизвестная операция маски')
  const layer = doc.layers.find((l) => l.id === id)
  if (!layer?.mask || isLayerLocked(doc, id))
    throw new Error('Выбери маску незаблокированного слоя.')
  const image = await loadImage(layer.mask.src),
    c = document.createElement('canvas')
  if (operation === 'invert') {
    if (image.width > 4096 || image.height > 4096 || image.width * image.height > 16_777_216)
      throw new Error('Эта операция поддерживает маску до 4096 × 4096.')
    c.width = image.width
    c.height = image.height
    const x = c.getContext('2d')!
    x.drawImage(image, 0, 0)
    const data = x.getImageData(0, 0, c.width, c.height)
    data.data.set(transformMaskPixels(data.data, operation))
    x.putImageData(data, 0, 0)
  } else {
    c.width = c.height = 1
    const x = c.getContext('2d')!
    x.fillStyle = operation === 'white' ? '#ffffff' : '#000000'
    x.fillRect(0, 0, 1, 1)
  }
  const src = c.toDataURL('image/png')
  cacheImage(src, c)
  const mask: LayerMask = {
    ...layer.mask,
    src,
    defaultColor:
      operation === 'invert' ? 255 - layer.mask.defaultColor : operation === 'white' ? 255 : 0,
  }
  const next = { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, mask } : l)) }
  validateRasterBudget(next)
  return next
}
