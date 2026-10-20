import { describe, expect, it } from 'vitest'
import {
  WORKING_RGB_PROFILE,
  buildIccProfile,
  builtinColorProfile,
  convertRgbTriplet,
  createColorTransform,
  parseIccProfile,
  recognizedBuiltinProfileId,
} from '../../src/engine/colorProfiles'

const Adobe = builtinColorProfile('adobe-rgb-1998')!
const p3 = builtinColorProfile('display-p3')!
const sGray = builtinColorProfile('sgray')!
const gray22 = builtinColorProfile('gray-gamma-2.2')!

describe('ICC profile parsing and generation', () => {
  it('recognizes the names Photoshop users actually meet', () => {
    expect(recognizedBuiltinProfileId('sRGB IEC61966-2.1')).toBe('srgb-iec61966-2-1')
    expect(recognizedBuiltinProfileId('sGray')).toBe('sgray')
    expect(recognizedBuiltinProfileId('Adobe RGB (1998)')).toBe('adobe-rgb-1998')
    expect(recognizedBuiltinProfileId('Display P3')).toBe('display-p3')
    expect(recognizedBuiltinProfileId('Gray Gamma 2.2')).toBe('gray-gamma-2.2')
  })

  it('round-trips generated RGB and grayscale ICC profiles', () => {
    for (const model of [WORKING_RGB_PROFILE, Adobe, p3, sGray, gray22]) {
      const bytes = buildIccProfile(model)
      const parsed = parseIccProfile(bytes)
      expect(parsed?.name).toBe(model.name)
      expect(parsed?.recognizedId).toBe(model.id)
      expect(parsed?.model?.kind).toBe(model.kind)
      expect(parsed?.unsupportedReason).toBeUndefined()
      expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe('acsp')
    }
  })

  it('rejects malformed profiles without throwing', () => {
    expect(parseIccProfile(new Uint8Array(20))).toBeUndefined()
    const bytes = buildIccProfile(Adobe)
    const broken = bytes.slice()
    new DataView(broken.buffer).setUint32(0, broken.length + 100)
    expect(parseIccProfile(broken)).toBeUndefined()

    const badTag = bytes.slice()
    // Point the rXYZ entry (after desc/cprt/wtpt/bkpt) outside the profile.
    new DataView(badTag.buffer).setUint32(132 + 4 * 12 + 4, badTag.length + 8)
    const parsed = parseIccProfile(badTag)
    expect(parsed?.model).toBeUndefined()
    expect(parsed?.unsupportedReason).toContain('матрич')
  })
})

describe('matrix/TRC colour conversion', () => {
  it('keeps sRGB to sRGB an exact identity', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [12, 34, 56],
      [128, 128, 128],
      [250, 3, 99],
    ] as const)
      expect(convertRgbTriplet(rgb, WORKING_RGB_PROFILE, WORKING_RGB_PROFILE)).toEqual([...rgb])
  })

  it('converts Adobe RGB and grayscale transfer curves into sRGB', () => {
    const neutral = convertRgbTriplet([128, 128, 128], Adobe, WORKING_RGB_PROFILE)
    expect(neutral[0]).toBeGreaterThanOrEqual(128)
    expect(neutral[0]).toBeLessThanOrEqual(131)
    expect(neutral).toEqual([neutral[0], neutral[0], neutral[0]])

    const colour = convertRgbTriplet([51, 102, 153], Adobe, WORKING_RGB_PROFILE)
    expect(colour).not.toEqual([51, 102, 153])
    expect(colour[2]).toBeGreaterThan(colour[1])
    expect(colour[1]).toBeGreaterThan(colour[0])

    // sGray is the sRGB tone curve in a one-channel profile.
    expect(convertRgbTriplet([128, 0, 0], sGray, WORKING_RGB_PROFILE)).toEqual([128, 128, 128])
    const gammaGray = convertRgbTriplet([128, 0, 0], gray22, WORKING_RGB_PROFILE)
    expect(gammaGray[0]).toBeGreaterThanOrEqual(128)
    expect(gammaGray[0]).toBeLessThanOrEqual(131)
  })

  it('converts out of sRGB for export destinations', () => {
    const AdobeNeutral = convertRgbTriplet([128, 128, 128], WORKING_RGB_PROFILE, Adobe)
    expect(AdobeNeutral[0]).toBeGreaterThanOrEqual(126)
    expect(AdobeNeutral[0]).toBeLessThanOrEqual(129)
    expect(AdobeNeutral).toEqual([AdobeNeutral[0], AdobeNeutral[0], AdobeNeutral[0]])

    const gray = convertRgbTriplet([255, 0, 0], WORKING_RGB_PROFILE, sGray)
    expect(gray[0]).toBeGreaterThan(120)
    expect(gray[0]).toBeLessThan(150)
    expect(gray).toEqual([gray[0], gray[0], gray[0]])
  })

  it('preserves alpha and deliberately changes only colour channels', () => {
    const data = new Uint8ClampedArray([
      30, 90, 180, 0, 30, 90, 180, 77, 30, 90, 180, 255, 255, 255, 255, 13,
    ])
    createColorTransform(Adobe, WORKING_RGB_PROFILE).transformPixels(data, 2, 2)
    expect([...data.filter((_, i) => i % 4 === 3)]).toEqual([0, 77, 255, 13])
    expect([...data.subarray(0, 3)]).toEqual([...data.subarray(4, 7)])
    expect([...data.subarray(0, 3)]).not.toEqual([30, 90, 180])
  })

  it('can apply deterministic ordered dithering', () => {
    const width = 8
    const height = 8
    const make = () => {
      const data = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < data.length; i += 4) data.set([73, 73, 73, 255], i)
      return data
    }
    const first = make()
    const second = make()
    createColorTransform(Adobe, WORKING_RGB_PROFILE, { dither: true }).transformPixels(
      first,
      width,
      height,
    )
    createColorTransform(Adobe, WORKING_RGB_PROFILE, { dither: true }).transformPixels(
      second,
      width,
      height,
    )
    expect([...first]).toEqual([...second])
  })
})
