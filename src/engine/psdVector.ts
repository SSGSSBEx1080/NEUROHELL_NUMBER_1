import type { Layer as PsdLayer, Color } from 'ag-psd'
import type { Layer, ShapePath } from '../types'
import { cornerRadii, pathBounds, shapePaths, transformedPaths } from './shapeGeometry'
const px = (value: number) => ({ units: 'Pixels' as const, value })
const rgb = (color: string) => ({
  r: parseInt(color.slice(1, 3), 16),
  g: parseInt(color.slice(3, 5), 16),
  b: parseInt(color.slice(5, 7), 16),
})
const hex = (color?: Color) =>
  color && 'r' in color
    ? '#' +
      [color.r, color.g, color.b]
        .map((n) =>
          Math.round(Math.max(0, Math.min(255, n)))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    : undefined
export function exportVectorShape(layer: Layer, dpi = 72): Partial<PsdLayer> {
  const native: Partial<PsdLayer> = {
    vectorFill: { type: 'color', color: rgb(layer.color) },
    vectorMask: { fillStartsWithAllPixels: false, paths: transformedPaths(layer) },
    vectorStroke: {
      strokeEnabled: !!layer.strokeColor && !!layer.strokeWidth,
      fillEnabled: layer.shapeFill !== false && layer.shape !== 'line',
      lineWidth: px(layer.strokeWidth || 0),
      lineAlignment: layer.shape === 'line' ? 'center' : layer.strokeAlign || 'center',
      lineCapType: layer.strokeCap || 'butt',
      lineJoinType: layer.strokeJoin || 'miter',
      miterLimit: layer.strokeMiterLimit || 4,
      lineDashOffset: px(layer.strokeDashOffset || 0),
      lineDashSet: (layer.strokeDash || []).map(px),
      content: { type: 'color', color: rgb(layer.strokeColor || layer.color) },
      opacity: 1,
      blendMode: 'normal',
      resolution: dpi,
      scaleLock: false,
      strokeAdjust: false,
    },
  }
  if (
    !layer.warp &&
    !layer.rotation &&
    !layer.flipX &&
    !layer.flipY &&
    ['rectangle', 'ellipse'].includes(layer.shape || 'rectangle')
  ) {
    const [a, b, c, d] = cornerRadii(layer),
      rounded = [a, b, c, d].some(Boolean) && layer.shape !== 'ellipse'
    native.vectorOrigination = {
      keyDescriptorList: [
        {
          keyOriginType: layer.shape === 'ellipse' ? 5 : rounded ? 2 : 1,
          keyOriginResolution: dpi,
          keyOriginShapeBoundingBox: {
            left: px(layer.x),
            top: px(layer.y),
            right: px(layer.x + layer.width),
            bottom: px(layer.y + layer.height),
          },
          ...(rounded
            ? {
                keyOriginRRectRadii: {
                  topLeft: px(a),
                  topRight: px(b),
                  bottomRight: px(c),
                  bottomLeft: px(d),
                },
              }
            : {}),
        },
      ],
    }
  } else native.vectorOrigination = { keyDescriptorList: [{ keyShapeInvalidated: true }] }
  return native
}
/** Keep unsupported gradient/pattern/Boolean masks intact as original PSD structures.
 * Return editable curves only when the working renderer can represent the complete vector content.
 */
export function importVectorShape(src: PsdLayer): Partial<Layer> | undefined {
  const fill = src.vectorFill,
    mask = src.vectorMask,
    stroke = src.vectorStroke
  if (
    !fill ||
    fill.type !== 'color' ||
    !hex(fill.color) ||
    !mask?.paths.length ||
    mask.disable ||
    mask.invert ||
    mask.fillStartsWithAllPixels ||
    mask.paths.some(
      (p) =>
        (p.operation && p.operation !== 'combine') ||
        p.knots.length < 2 ||
        p.fillRule !== mask.paths[0].fillRule,
    ) ||
    (stroke?.strokeEnabled &&
      (stroke.content?.type !== 'color' ||
        !hex(stroke.content.color) ||
        (stroke.opacity ?? 1) !== 1 ||
        (stroke.blendMode && stroke.blendMode !== 'normal')))
  )
    return
  const paths = mask.paths as ShapePath[],
    bounds = pathBounds(paths)
  if (
    bounds.width > 16384 ||
    bounds.height > 16384 ||
    paths.reduce((n, p) => n + p.knots.length, 0) > 8192
  )
    return
  const layer: Partial<Layer> = {
    kind: 'shape',
    shape: 'path',
    x: bounds.x,
    y: bounds.y,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
    color: hex(fill.color)!,
    shapeFill: stroke?.fillEnabled !== false,
    strokeColor: stroke?.content?.type === 'color' ? hex(stroke.content.color) : undefined,
    strokeWidth: stroke?.strokeEnabled ? stroke.lineWidth?.value || 0 : 0,
    strokeAlign: stroke?.lineAlignment || 'center',
    strokeCap: stroke?.lineCapType || 'butt',
    strokeJoin: stroke?.lineJoinType || 'miter',
    strokeMiterLimit: stroke?.miterLimit || 4,
    strokeDash: stroke?.lineDashSet?.map((d) => d.value) || [],
    strokeDashOffset: stroke?.lineDashOffset?.value || 0,
  }
  layer.shapePaths = paths.map((p) => ({
    ...p,
    knots: p.knots.map((k) => ({
      ...k,
      points: k.points.map(
        (v, i) => (v - (i % 2 ? bounds.y : bounds.x)) / (i % 2 ? layer.height! : layer.width!),
      ),
    })),
  }))
  const origin = src.vectorOrigination?.keyDescriptorList
  if (
    origin?.length === 1 &&
    !origin[0].keyShapeInvalidated &&
    !origin[0].transform &&
    [1, 2, 5].includes(origin[0].keyOriginType || 0)
  ) {
    const o = origin[0],
      b = o.keyOriginShapeBoundingBox
    if (
      b &&
      Math.abs(b.left.value - bounds.x) < 0.002 &&
      Math.abs(b.top.value - bounds.y) < 0.002 &&
      Math.abs(b.right.value - bounds.x - bounds.width) < 0.002 &&
      Math.abs(b.bottom.value - bounds.y - bounds.height) < 0.002
    ) {
      const radii = o.keyOriginRRectRadii
      const primitive: Partial<Layer> = {
        ...layer,
        x: b.left.value,
        y: b.top.value,
        width: b.right.value - b.left.value,
        height: b.bottom.value - b.top.value,
        shape: o.keyOriginType === 5 ? 'ellipse' : 'rectangle',
        cornerRadii: radii
          ? [
              radii.topLeft.value,
              radii.topRight.value,
              radii.bottomRight.value,
              radii.bottomLeft.value,
            ]
          : [0, 0, 0, 0],
      }
      // Origin descriptors can be stale. Trust them only if ALL curve coordinates agree.
      const expected = shapePaths(primitive as Layer),
        actual = paths
      if (
        expected.length === actual.length &&
        expected.every(
          (p, i) =>
            p.knots.length === actual[i].knots.length &&
            p.knots.every((k, j) =>
              k.points.every(
                (v, c) =>
                  Math.abs(
                    v + (c % 2 ? primitive.y! : primitive.x!) - actual[i].knots[j].points[c],
                  ) < 0.003,
              ),
            ),
        )
      )
        return { ...primitive, shapePaths: undefined }
    }
  }
  return layer
}
/** Native vector coordinates are document-relative, unlike our local contours. */
export function translateNativeVector(src: PsdLayer, dx: number, dy: number): Partial<PsdLayer> {
  return {
    ...(src.vectorMask
      ? {
          vectorMask: {
            ...src.vectorMask,
            paths: src.vectorMask.paths.map((p) => ({
              ...p,
              knots: p.knots.map((k) => ({
                ...k,
                points: k.points.map((n, i) => n + (i % 2 ? dy : dx)),
              })),
            })),
          },
        }
      : {}),
    ...(src.vectorOrigination
      ? {
          vectorOrigination: {
            keyDescriptorList: src.vectorOrigination.keyDescriptorList.map((o) => ({
              ...o,
              ...(o.keyOriginShapeBoundingBox
                ? {
                    keyOriginShapeBoundingBox: Object.fromEntries(
                      Object.entries(o.keyOriginShapeBoundingBox).map(([k, v]) => [
                        k,
                        { ...v, value: v.value + (k === 'left' || k === 'right' ? dx : dy) },
                      ]),
                    ) as typeof o.keyOriginShapeBoundingBox,
                  }
                : {}),
              ...(o.keyOriginBoxCorners
                ? {
                    keyOriginBoxCorners: o.keyOriginBoxCorners.map((p) => ({
                      x: p.x + dx,
                      y: p.y + dy,
                    })),
                  }
                : {}),
              ...(o.transform
                ? { transform: o.transform.map((v, i) => v + (i === 4 ? dx : i === 5 ? dy : 0)) }
                : {}),
            })),
          },
        }
      : {}),
  }
}
