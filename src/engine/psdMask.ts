import type { Layer as PsdLayer, LayerMaskData } from 'ag-psd'

export interface PsdCompositeMask {
  data: LayerMaskData
  enabled: boolean
}

const neutralDensity = (value?: number) =>
  value === undefined || (Number.isFinite(value) && value >= 0.999 && value <= 1.001)
const neutralFeather = (value?: number) =>
  value === undefined || (Number.isFinite(value) && value === 0)

/**
 * A PSD layer with both a pixel mask and a vector mask also stores their baked
 * composite in channel -3 (`realMask`). That composite is the only coverage a
 * one-raster-mask editor can reproduce without a vector-mask rasterizer, so it
 * is accepted only where its meaning is unambiguous:
 *
 * - ag-psd actually decoded channel -3 (a header-looking parameter block with
 *   no -3 channel yields no `imageData`, and is rejected);
 * - the decoded size matches the stored rectangle exactly;
 * - both component densities/feathers are neutral (two independent density /
 *   feather pairs cannot be reconstructed from the baked product);
 * - the components are either both enabled or both disabled (a single enabled
 *   flag cannot express "pixel off, vector on");
 * - it is not a shape/fill layer, whose stored alpha already includes the
 *   vector path (applying the composite again would square its edges).
 *
 * Anything else returns undefined and the caller keeps the previous
 * pixel-mask-only import plus an explicit compatibility warning.
 */
export function psdCompositeMask(src: PsdLayer): PsdCompositeMask | undefined {
  const real = src.realMask,
    data = real?.imageData
  if (!real || !data || !src.vectorMask || src.vectorFill) return undefined
  const left = real.left || 0,
    top = real.top || 0,
    width = (real.right || 0) - left,
    height = (real.bottom || 0) - top
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(top) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    data.width !== width ||
    data.height !== height ||
    data.data.byteLength < width * height * 4
  )
    return undefined
  for (const mask of [src.mask, real]) {
    if (!mask) continue
    if (
      !neutralDensity(mask.userMaskDensity) ||
      !neutralDensity(mask.vectorMaskDensity) ||
      !neutralFeather(mask.userMaskFeather) ||
      !neutralFeather(mask.vectorMaskFeather)
    )
      return undefined
  }
  const pixelDisabled = !!src.mask?.disabled,
    vectorDisabled = !!src.vectorMask.disable
  if (!pixelDisabled && !vectorDisabled && !real.disabled) return { data: real, enabled: true }
  if (pixelDisabled && vectorDisabled) return { data: real, enabled: false }
  return undefined
}
