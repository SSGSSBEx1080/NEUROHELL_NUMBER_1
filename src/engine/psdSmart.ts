import type { Layer as PsdLayer, PlacedLayer, PlacedLayerFilter, Warp } from 'ag-psd'
import { DEFAULT_ADJUSTMENTS, type Layer, type LayerStyles, type Quad } from '../types'
import { rectangleQuad, validQuad } from './projection'
import { hasStyles } from './styles'

/** ag-psd emits a regular 4×4 envelope even when there is no actual envelope warp. */
export function identityEnvelope(warp?: Warp): boolean {
  if (!warp) return true
  if (warp.value || warp.perspective || warp.perspectiveOther || warp.values?.some(Boolean))
    return false
  if (!warp.style || warp.style === 'none') return !warp.customEnvelopeWarp
  const mesh = warp.customEnvelopeWarp,
    bounds = warp.bounds
  if (
    warp.style !== 'custom' ||
    !bounds ||
    !mesh ||
    mesh.meshPoints.length !== 16 ||
    warp.uOrder !== 4 ||
    warp.vOrder !== 4 ||
    warp.deformNumRows ||
    warp.deformNumCols ||
    mesh.quiltSliceX?.length ||
    mesh.quiltSliceY?.length
  )
    return false
  if (Object.values(bounds).some((b) => b.units !== 'Pixels' || !Number.isFinite(b.value)))
    return false
  const left = bounds.left.value,
    top = bounds.top.value,
    width = bounds.right.value - left,
    height = bounds.bottom.value - top
  if (width <= 0 || height <= 0) return false
  return mesh.meshPoints.every(
    (p, i) =>
      Math.abs(p.x - left - (width * (i % 4)) / 3) < 0.00001 &&
      Math.abs(p.y - top - (height * Math.floor(i / 4)) / 3) < 0.00001,
  )
}

/** undefined means unsupported, not "silently ignore this filter". */
export function nativeGaussianRadius(filter?: PlacedLayerFilter): number | undefined {
  if (!filter || !filter.enabled) return 0
  if (filter.maskEnabled || !filter.validAtPosition) return
  const active = filter.list.filter((f) => f.enabled)
  if (!active.length) return 0
  if (active.length !== 1) return
  const f = active[0]
  if (
    f.type !== 'gaussian blur' ||
    f.opacity !== 1 ||
    f.blendMode !== 'normal' ||
    f.filter.radius.units !== 'Pixels' ||
    !Number.isFinite(f.filter.radius.value) ||
    f.filter.radius.value < 0 ||
    f.filter.radius.value > 30
  )
    return
  return f.filter.radius.value
}

export function gaussianSmartFilter(radius: number): PlacedLayerFilter | undefined {
  if (!radius) return
  return {
    enabled: true,
    validAtPosition: true,
    maskEnabled: false,
    maskLinked: false,
    maskExtendWithWhite: true,
    list: [
      {
        type: 'gaussian blur',
        filter: { radius: { units: 'Pixels', value: radius } },
        name: 'Gaussian Blur',
        opacity: 1,
        blendMode: 'normal',
        enabled: true,
        hasOptions: true,
        foregroundColor: { r: 0, g: 0, b: 0 },
        backgroundColor: { r: 255, g: 255, b: 255 },
      },
    ],
  }
}

/** Only promote placements the working renderer can express without losing a mask,
 * envelope, layer-comp selection, animation or unsupported smart filter. */
export function nativeSmartPlacement(
  src: PsdLayer,
  width: number,
  height: number,
  styles?: LayerStyles,
): Partial<Layer> | undefined {
  const placed = src.placedLayer
  if (
    !placed ||
    src.mask ||
    src.realMask ||
    src.vectorMask ||
    placed.type === 'image stack' ||
    (placed.totalPages || 1) > 1 ||
    (placed.frameCount || 0) > 1 ||
    (placed.comp !== undefined && placed.comp >= 0) ||
    (placed.compInfo !== undefined && placed.compInfo.compID >= 0) ||
    (placed.crop !== undefined && placed.crop !== 0) ||
    !!placed.duration?.numerator ||
    !identityEnvelope(placed.warp)
  )
    return
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 4096 ||
    height > 4096
  )
    return
  const transform = placed.nonAffineTransform || placed.transform,
    blur = nativeGaussianRadius(placed.filter)
  if (
    blur === undefined ||
    transform.length !== 8 ||
    transform.some((n) => !Number.isFinite(n) || Math.abs(n) > 32768)
  )
    return
  let points = [0, 2, 4, 6].map((i) => ({ x: transform[i], y: transform[i + 1] })) as Quad
  const [a, b, c] = points
  const flipX = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) < 0
  if (flipX) points = [points[1], points[0], points[3], points[2]]
  const origin = points[0],
    quad = points.map((p) => ({ x: (p.x - origin.x) / width, y: (p.y - origin.y) / height }))
  if (!validQuad(quad)) return
  const identity = quad.every(
    (p, i) =>
      Math.abs(p.x - rectangleQuad()[i].x) < 1e-7 && Math.abs(p.y - rectangleQuad()[i].y) < 1e-7,
  )
  // Photoshop's outer FX are in document space; our local FX cannot be quietly
  // transformed with a nonidentity placement. Unmodified originals remain intact.
  if (hasStyles(styles) && (!identity || flipX)) return
  return {
    x: origin.x,
    y: origin.y,
    width,
    height,
    rotation: 0,
    flipX,
    flipY: false,
    warp: identity ? undefined : quad,
    adjustments: { ...DEFAULT_ADJUSTMENTS, blur },
  }
}

export function translateNativePlacement(placed: PlacedLayer, dx: number, dy: number): PlacedLayer {
  const translate = (values: number[]) => values.map((n, i) => n + (i % 2 ? dy : dx))
  return {
    ...placed,
    transform: translate(placed.transform),
    ...(placed.nonAffineTransform
      ? { nonAffineTransform: translate(placed.nonAffineTransform) }
      : {}),
  }
}
