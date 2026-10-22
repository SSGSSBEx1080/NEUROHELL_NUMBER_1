import type { EditorDocument, GlobalLightSettings, LayerStyles, ShadowEffectStyle } from '../types'

export const DEFAULT_GLOBAL_LIGHT: GlobalLightSettings = { angle: 120, altitude: 30 }

/** Local shadow offsets have a 180 px per-axis model limit. */
const MAX_SHADOW_OFFSET = 180

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export const normalizeLightAngle = (
  value: unknown,
  fallback = DEFAULT_GLOBAL_LIGHT.angle,
): number => (finite(value) ? ((((value + 180) % 360) + 360) % 360) - 180 : fallback)

export const normalizeLightAltitude = (
  value: unknown,
  fallback = DEFAULT_GLOBAL_LIGHT.altitude,
): number => (finite(value) ? Math.min(90, Math.max(0, value)) : fallback)

export function normalizeGlobalLight(
  input?: Partial<GlobalLightSettings> | null,
): GlobalLightSettings {
  return {
    angle: normalizeLightAngle(input?.angle),
    altitude: normalizeLightAltitude(input?.altitude),
  }
}

/** Project/JSON gateway. Absence stays absence so legacy documents do not relight on load. */
export function parseGlobalLight(input: unknown): GlobalLightSettings | undefined {
  const value = record(input)
  if (!value) return undefined
  return {
    angle: normalizeLightAngle(value.angle),
    altitude: normalizeLightAltitude(value.altitude),
  }
}

/**
 * PSD image resources 1037/1049. Photoshop's file-format reference says a
 * missing Global Angle is assumed to be 30°, while the altitude used by the
 * real fixtures is 30°. If both resources are absent, there is no explicit
 * master in our model and the effect descriptors remain authoritative.
 */
export function globalLightFromPsdResources(
  resources?: {
    globalAngle?: unknown
    globalAltitude?: unknown
  } | null,
): GlobalLightSettings | undefined {
  if (!resources || (resources.globalAngle === undefined && resources.globalAltitude === undefined))
    return undefined
  return {
    angle: normalizeLightAngle(resources.globalAngle, 30),
    altitude: normalizeLightAltitude(resources.globalAltitude, 30),
  }
}

/** Resource 1037 is an unsigned 0..359 integer in the PSD specification. */
export const psdGlobalAngleResource = (angle: number): number => {
  const wrapped = ((normalizeLightAngle(angle) % 360) + 360) % 360
  return Math.round(wrapped) % 360
}

export const psdGlobalAltitudeResource = (altitude: number): number =>
  Math.round(normalizeLightAltitude(altitude))

const cleanZero = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value)

export const shadowDistance = (effect: Pick<ShadowEffectStyle, 'x' | 'y'>): number => {
  const distance = Math.hypot(effect.x || 0, effect.y || 0)
  return Number.isFinite(distance) ? distance : 0
}

/** Inverse of the PSD conversion x=-cos(angle)*distance, y=sin(angle)*distance. */
export const shadowLightAngle = (
  effect: Pick<ShadowEffectStyle, 'x' | 'y'>,
  fallback = DEFAULT_GLOBAL_LIGHT.angle,
): number => {
  if (shadowDistance(effect) <= 1e-9) return normalizeLightAngle(fallback)
  return normalizeLightAngle((Math.atan2(effect.y || 0, -(effect.x || 0)) * 180) / Math.PI)
}

export function shadowOffsetForLightAngle(
  distance: number,
  angle: number,
): { x: number; y: number } {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0
  const radians = (normalizeLightAngle(angle) * Math.PI) / 180
  let x = -Math.cos(radians) * safeDistance
  let y = Math.sin(radians) * safeDistance
  const largest = Math.max(Math.abs(x), Math.abs(y))
  if (largest > MAX_SHADOW_OFFSET) {
    const scale = MAX_SHADOW_OFFSET / largest
    x *= scale
    y *= scale
  }
  return { x: cleanZero(x), y: cleanZero(y) }
}

export const lightAngleDifference = (a: number, b: number): number => {
  const difference = Math.abs(normalizeLightAngle(a) - normalizeLightAngle(b)) % 360
  return difference > 180 ? 360 - difference : difference
}

function synchronizeShadow(
  effect: ShadowEffectStyle,
  light: GlobalLightSettings,
): ShadowEffectStyle {
  if (effect.useGlobalLight !== true) return effect
  const offset = shadowOffsetForLightAngle(shadowDistance(effect), light.angle)
  return effect.x === offset.x && effect.y === offset.y ? effect : { ...effect, ...offset }
}

/**
 * Copy the master angle into linked Drop/Inner Shadow offsets and the Bevel
 * angle/altitude. Satin has its own offset axis and is intentionally not a
 * Global Light effect. Unchanged objects retain their identity.
 */
export function synchronizeStylesToGlobalLight(
  styles: LayerStyles | undefined,
  input: Partial<GlobalLightSettings> | GlobalLightSettings,
): LayerStyles | undefined {
  if (!styles) return styles
  const light = normalizeGlobalLight(input)
  const shadows = styles.shadows.map((effect) => synchronizeShadow(effect, light))
  const innerShadows = styles.innerShadows.map((effect) => synchronizeShadow(effect, light))
  const bevel =
    styles.bevel.useGlobalLight &&
    (styles.bevel.angle !== light.angle || styles.bevel.altitude !== light.altitude)
      ? { ...styles.bevel, angle: light.angle, altitude: light.altitude }
      : styles.bevel
  if (
    shadows.every((effect, index) => effect === styles.shadows[index]) &&
    innerShadows.every((effect, index) => effect === styles.innerShadows[index]) &&
    bevel === styles.bevel
  )
    return styles
  return { ...styles, shadows, innerShadows, bevel }
}

export function synchronizeDocumentGlobalLight(
  doc: EditorDocument,
  input: Partial<GlobalLightSettings> | GlobalLightSettings,
): EditorDocument {
  const light = normalizeGlobalLight(input)
  let changed =
    doc.globalLight?.angle !== light.angle || doc.globalLight?.altitude !== light.altitude
  const layers = doc.layers.map((layer) => {
    const styles = synchronizeStylesToGlobalLight(layer.styles, light)
    if (styles === layer.styles) return layer
    changed = true
    return { ...layer, styles }
  })
  return changed ? { ...doc, globalLight: light, layers } : doc
}

export function deriveGlobalLightFromStyles(styles?: LayerStyles): GlobalLightSettings | undefined {
  if (!styles) return undefined
  if (styles.bevel.enabled && styles.bevel.useGlobalLight)
    return {
      angle: normalizeLightAngle(styles.bevel.angle),
      altitude: normalizeLightAltitude(styles.bevel.altitude),
    }
  for (const effect of [...styles.shadows, ...styles.innerShadows])
    if (effect.enabled && effect.useGlobalLight === true)
      return { angle: shadowLightAngle(effect), altitude: DEFAULT_GLOBAL_LIGHT.altitude }
  return undefined
}

/** Explicit master, else the first enabled linked effect (legacy documents), else the UI default. */
export function effectiveGlobalLight(doc: EditorDocument): GlobalLightSettings {
  const explicit = parseGlobalLight(doc.globalLight)
  if (explicit) return explicit
  for (const layer of doc.layers) {
    const derived = deriveGlobalLightFromStyles(layer.styles)
    if (derived) return derived
  }
  return { ...DEFAULT_GLOBAL_LIGHT }
}

function enabledLinkedLightValues(doc: EditorDocument): { angles: number[]; altitudes: number[] } {
  const angles: number[] = []
  const altitudes: number[] = []
  for (const layer of doc.layers) {
    const styles = layer.styles
    if (!styles) continue
    for (const effect of [...styles.shadows, ...styles.innerShadows])
      if (effect.enabled && effect.useGlobalLight === true && shadowDistance(effect) > 1e-9)
        angles.push(shadowLightAngle(effect))
    if (styles.bevel.enabled && styles.bevel.useGlobalLight) {
      angles.push(normalizeLightAngle(styles.bevel.angle))
      altitudes.push(normalizeLightAltitude(styles.bevel.altitude))
    }
  }
  return { angles, altitudes }
}

/**
 * A PSD-export-only master for legacy documents whose enabled linked effects
 * already agree. If they disagree, there is no honest single resource value.
 */
export function consistentGlobalLight(doc: EditorDocument): GlobalLightSettings | undefined {
  const { angles, altitudes } = enabledLinkedLightValues(doc)
  if (!angles.length) return undefined
  if (angles.some((angle) => lightAngleDifference(angle, angles[0]) > 0.01)) return undefined
  if (altitudes.some((altitude) => Math.abs(altitude - altitudes[0]) > 0.01)) return undefined
  return { angle: angles[0], altitude: altitudes[0] ?? DEFAULT_GLOBAL_LIGHT.altitude }
}

export function hasConflictingLinkedGlobalLight(doc: EditorDocument): boolean {
  const { angles, altitudes } = enabledLinkedLightValues(doc)
  return (
    angles.some((angle) => lightAngleDifference(angle, angles[0]) > 0.01) ||
    altitudes.some((altitude) => Math.abs(altitude - altitudes[0]) > 0.01)
  )
}

export function countLinkedGlobalLightEffects(doc: EditorDocument, enabledOnly = false): number {
  let count = 0
  for (const layer of doc.layers) {
    if (!layer.styles) continue
    count += layer.styles.shadows.filter(
      (effect) => effect.useGlobalLight === true && (!enabledOnly || effect.enabled),
    ).length
    count += layer.styles.innerShadows.filter(
      (effect) => effect.useGlobalLight === true && (!enabledOnly || effect.enabled),
    ).length
    if (layer.styles.bevel.useGlobalLight && (!enabledOnly || layer.styles.bevel.enabled)) count++
  }
  return count
}
