import { describe, expect, it } from 'vitest'
import { initializeCanvas, readPsd, writePsd } from 'ag-psd'
import { __psdStyleCodecForTests } from '../../src/engine/psd'
import { normalizeStyles } from '../../src/engine/styles'

initializeCanvas(
  () => {
    throw new Error('No canvas')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)

describe('multi-instance layer styles in native PSD effects', () => {
  it('writes three strokes, two shadows, inner effects and a full gradient to binary PSD', () => {
    const styles = normalizeStyles({
      fillOpacity: 0.35,
      strokes: [
        { enabled: true, size: 2, color: '#ffffff', position: 'outside', opacity: 1 },
        { enabled: true, size: 6, color: '#ff5c39', position: 'outside', opacity: 0.8 },
        { enabled: true, size: 12, color: '#152546', position: 'outside', opacity: 0.6 },
      ],
      shadows: [
        { enabled: true, color: '#000000', blur: 4, x: 3, y: 5, opacity: 0.7 },
        { enabled: true, color: '#2244aa', blur: 12, x: -8, y: 10, opacity: 0.4 },
      ],
      innerShadows: [{ enabled: true, color: '#000000', blur: 5, x: 0, y: 3, opacity: 0.5 }],
      glow: { enabled: true, color: '#b6a3ff', blur: 9, opacity: 0.6 },
      innerGlow: { enabled: true, color: '#ffffff', blur: 7, opacity: 0.5 },
      overlays: [{ enabled: true, color: '#123456', opacity: 0.25, blendMode: 'multiply' }],
      gradients: [
        {
          enabled: true,
          angle: 30,
          opacity: 0.9,
          reverse: true,
          blendMode: 'screen',
          gradient: {
            name: 'Три точки',
            kind: 'solid',
            stops: [
              { position: 0, color: '#ffd166', midpoint: 0.3 },
              { position: 0.5, color: '#ff5c39' },
              { position: 1, color: '#7c1d5c' },
            ],
            opacityStops: [
              { position: 0, opacity: 0.5 },
              { position: 1, opacity: 1 },
            ],
          },
        },
      ],
    })!
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const bytes = writePsd({
      width: 4,
      height: 4,
      children: [{ name: 'fx', effects, fillOpacity: styles.fillOpacity }],
    })
    const layer = readPsd(bytes, { useImageData: true }).children![0]
    expect(layer.effects?.stroke).toHaveLength(3)
    expect(layer.effects?.stroke?.map((s) => s.size?.value)).toEqual([2, 6, 12])
    expect(layer.effects?.dropShadow).toHaveLength(2)
    expect(layer.effects?.innerShadow).toHaveLength(1)
    expect(layer.effects?.solidFill).toHaveLength(1)
    expect(layer.effects?.solidFill?.[0].blendMode).toBe('multiply')
    expect(layer.effects?.outerGlow?.enabled).toBe(true)
    expect(layer.effects?.innerGlow?.enabled).toBe(true)
    const gradient = layer.effects?.gradientOverlay?.[0]
    expect(gradient?.blendMode).toBe('screen')
    expect(gradient?.reverse).toBe(true)
    if (!gradient?.gradient || gradient.gradient.type !== 'solid') throw new Error('solid expected')
    expect(gradient.gradient.colorStops).toHaveLength(3)
    expect(gradient.gradient.colorStops[0].midpoint).toBeCloseTo(0.3, 2)
    expect(gradient.gradient.opacityStops[0].opacity).toBeCloseTo(0.5)

    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.fillOpacity).toBeCloseTo(0.35)
    expect(back.strokes.map((s) => s.size)).toEqual([2, 6, 12])
    expect(back.strokes[1].color).toBe('#ff5c39')
    expect(back.strokes[1].opacity).toBeCloseTo(0.8, 2)
    expect(back.shadows).toHaveLength(2)
    expect(back.shadows[0].x).toBeCloseTo(3, 0)
    expect(back.shadows[0].y).toBeCloseTo(5, 0)
    expect(back.innerShadows).toHaveLength(1)
    expect(back.innerGlow.enabled).toBe(true)
    expect(back.overlays[0].blendMode).toBe('multiply')
    expect(back.gradients[0].blendMode).toBe('screen')
    expect(back.gradients[0].gradient.stops).toHaveLength(3)
    expect(back.gradients[0].reverse).toBe(true)
  })

  it('round-trips gradient-filled strokes and shaped gradient overlays natively', () => {
    const styles = normalizeStyles({
      strokes: [
        {
          enabled: true,
          size: 8,
          position: 'outside',
          opacity: 0.9,
          fill: 'gradient',
          gradientShape: 'reflected',
          gradientAngle: 30,
          gradientScale: 1.25,
          gradientReverse: true,
          gradientDither: true,
          gradient: {
            name: 'Обводка',
            kind: 'solid',
            stops: [
              { position: 0, color: '#102030' },
              { position: 1, color: '#f0e0d0' },
            ],
          },
        },
      ],
      gradients: [
        {
          enabled: true,
          angle: 70,
          opacity: 0.8,
          reverse: false,
          dither: true,
          shape: 'radial',
          scale: 1.5,
          gradient: {
            name: 'Оверлей',
            kind: 'solid',
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
          },
        },
      ],
    })!
    expect(styles.strokes[0].fill).toBe('gradient')
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const layer = readPsd(writePsd({ width: 4, height: 4, children: [{ name: 'g', effects }] }), {
      useImageData: true,
    }).children![0]
    expect(layer.effects?.stroke?.[0].fillType).toBe('gradient')
    expect(layer.effects?.stroke?.[0].gradient?.style).toBe('reflected')
    expect(layer.effects?.stroke?.[0].gradient?.dither).toBe(true)
    expect(layer.effects?.gradientOverlay?.[0].dither).toBe(true)
    expect(layer.effects?.gradientOverlay?.[0].type).toBe('radial')
    expect(layer.effects?.gradientOverlay?.[0].scale).toBeCloseTo(1.5, 2)
    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.strokes[0].fill).toBe('gradient')
    expect(back.strokes[0].gradientShape).toBe('reflected')
    expect(back.strokes[0].gradientAngle).toBeCloseTo(30, 1)
    expect(back.strokes[0].gradientScale).toBeCloseTo(1.25, 2)
    expect(back.strokes[0].gradientReverse).toBe(true)
    expect(back.strokes[0].gradientDither).toBe(true)
    expect(back.strokes[0].gradient?.stops).toHaveLength(2)
    expect(back.gradients[0].dither).toBe(true)
    expect(back.gradients[0].shape).toBe('radial')
    expect(back.gradients[0].scale).toBeCloseTo(1.5, 2)
    expect(back.gradients[0].angle).toBeCloseTo(70, 1)
  })

  it('round-trips pattern overlay and pattern-filled strokes with native Patt resources', () => {
    const pattern = {
      id: '123e4567-e89b-52d3-a456-426614174000',
      name: 'Тестовая плитка',
      kind: 'checker',
      size: 2,
      foreground: '#ff0000',
      background: '#0000ff',
      seed: 777,
    }
    const styles = normalizeStyles({
      strokes: [
        {
          enabled: true,
          size: 5,
          position: 'outside',
          opacity: 0.9,
          fill: 'pattern',
          pattern,
        },
      ],
      pattern: {
        enabled: true,
        pattern,
        scale: 1.5,
        opacity: 0.8,
        blendMode: 'difference',
        phaseX: 3,
        phaseY: -2,
        align: false,
      },
    })!
    expect(styles.strokes[0].fill).toBe('pattern')
    expect(styles.pattern.pattern.id).toBe(pattern.id)
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const pixels = {
      width: 2,
      height: 2,
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255]),
    }
    const info = __psdStyleCodecForTests.patternInfoFromPixels(styles.pattern.pattern, pixels)
    const psd = readPsd(
      writePsd({ width: 4, height: 4, children: [{ name: 'p', effects }], patterns: [info] }),
      { useImageData: true },
    )
    const layer = psd.children![0]
    expect(psd.patterns).toHaveLength(1)
    expect(psd.patterns?.[0]).toMatchObject({
      id: pattern.id,
      bounds: { x: 0, y: 0, w: 2, h: 2 },
    })
    expect(psd.patterns?.[0].name).toContain('Тестовая плитка')
    expect([...(psd.patterns?.[0].data.slice(0, 8) || [])]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255,
    ])
    expect(layer.effects?.patternOverlay).toMatchObject({
      enabled: true,
      blendMode: 'difference',
      pattern: { id: pattern.id, name: pattern.name },
      phase: { x: 3, y: -2 },
      align: false,
    })
    expect(layer.effects?.patternOverlay?.scale).toBeCloseTo(1.5, 2)
    expect(layer.effects?.patternOverlay?.opacity).toBeCloseTo(0.8, 2)
    expect(layer.effects?.stroke?.[0].fillType).toBe('pattern')
    expect(layer.effects?.stroke?.[0].pattern).toMatchObject({ id: pattern.id, name: pattern.name })

    const warnings: string[] = []
    const back = __psdStyleCodecForTests.importStyles(
      layer,
      new Map([[pattern.id, styles.pattern.pattern]]),
      (message) => warnings.push(message),
    )!
    expect(warnings).toEqual([])
    expect(back.pattern).toMatchObject({
      enabled: true,
      scale: 1.5,
      opacity: 0.8,
      blendMode: 'difference',
      phaseX: 3,
      phaseY: -2,
      align: false,
    })
    expect(back.pattern.pattern.id).toBe(pattern.id)
    expect(back.strokes[0].fill).toBe('pattern')
    expect(back.strokes[0].pattern?.id).toBe(pattern.id)
  })

  it('round-trips a native noise gradient descriptor', () => {
    const styles = normalizeStyles({
      gradients: [
        {
          enabled: true,
          angle: 0,
          opacity: 1,
          reverse: false,
          gradient: {
            name: 'Шум Lab',
            kind: 'noise',
            stops: [
              { position: 0, color: '#000000' },
              { position: 1, color: '#ffffff' },
            ],
            noise: {
              roughness: 0.4,
              model: 'lab',
              seed: 123456,
              min: [0.1, 0.2, 0.3, 0],
              max: [0.9, 0.8, 0.7, 1],
              restrictColors: true,
              transparency: true,
            },
          },
        },
      ],
    })!
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const layer = readPsd(writePsd({ width: 4, height: 4, children: [{ name: 'n', effects }] }), {
      useImageData: true,
    }).children![0]
    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.gradients[0].gradient.kind).toBe('noise')
    expect(back.gradients[0].gradient.noise).toMatchObject({
      model: 'lab',
      seed: 123456,
      restrictColors: true,
      transparency: true,
    })
    expect(back.gradients[0].gradient.noise?.roughness).toBeCloseTo(0.4, 2)
    expect(back.gradients[0].gradient.noise?.min[0]).toBeCloseTo(0.1, 2)
  })

  it('round-trips Bevel & Emboss through the native PSD effect descriptor', () => {
    const styles = normalizeStyles({
      bevel: {
        enabled: true,
        style: 'pillow',
        technique: 'chiselSoft',
        depth: 1.8,
        direction: 'down',
        size: 17,
        soften: 3,
        angle: 210,
        altitude: 42,
        useGlobalLight: false,
        highlightColor: '#ffe08a',
        highlightBlendMode: 'overlay',
        highlightOpacity: 0.65,
        shadowColor: '#102040',
        shadowBlendMode: 'soft-light',
        shadowOpacity: 0.45,
      },
    })!
    expect(styles.bevel.angle).toBe(-150) // 210° canonicalizes to the same PSD direction.
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const layer = readPsd(writePsd({ width: 4, height: 4, children: [{ name: 'b', effects }] }), {
      useImageData: true,
    }).children![0]
    expect(layer.effects?.bevel).toMatchObject({
      enabled: true,
      style: 'pillow emboss',
      technique: 'chisel soft',
      direction: 'down',
      size: { units: 'Pixels', value: 17 },
      soften: { units: 'Pixels', value: 3 },
      angle: -150,
      altitude: 42,
      useGlobalLight: false,
      highlightBlendMode: 'overlay',
      shadowBlendMode: 'soft light',
      useTexture: false,
      useShape: false,
      contour: {
        name: 'Linear',
        curve: [
          { x: 0, y: 0 },
          { x: 255, y: 255 },
        ],
      },
    })
    expect(layer.effects?.bevel?.strength).toBeCloseTo(1.8, 2)
    expect(layer.effects?.bevel?.highlightOpacity).toBeCloseTo(0.65, 2)
    expect(layer.effects?.bevel?.shadowOpacity).toBeCloseTo(0.45, 2)

    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.bevel).toMatchObject({
      enabled: true,
      style: 'pillow',
      technique: 'chiselSoft',
      direction: 'down',
      size: 17,
      soften: 3,
      angle: -150,
      altitude: 42,
      useGlobalLight: false,
      highlightColor: '#ffe08a',
      highlightBlendMode: 'overlay',
      shadowColor: '#102040',
      shadowBlendMode: 'soft-light',
    })
    expect(back.bevel.depth).toBeCloseTo(1.8, 2)
    expect(back.bevel.highlightOpacity).toBeCloseTo(0.65, 2)
    expect(back.bevel.shadowOpacity).toBeCloseTo(0.45, 2)
  })

  it('round-trips Satin through the native PSD ChFX descriptor', () => {
    const styles = normalizeStyles({
      satin: {
        enabled: true,
        color: '#cc5c5c',
        blendMode: 'overlay',
        opacity: 0.62,
        angle: 199,
        distance: 23,
        size: 31,
        invert: false,
        antialiased: true,
      },
    })!
    expect(styles.satin.angle).toBe(-161)
    const effects = __psdStyleCodecForTests.exportStyles(styles)
    const layer = readPsd(writePsd({ width: 4, height: 4, children: [{ name: 's', effects }] }), {
      useImageData: true,
    }).children![0]
    expect(layer.effects?.satin).toMatchObject({
      enabled: true,
      blendMode: 'overlay',
      angle: -161,
      distance: { units: 'Pixels', value: 23 },
      size: { units: 'Pixels', value: 31 },
      invert: false,
      antialiased: true,
      contour: {
        name: 'Linear',
        curve: [
          { x: 0, y: 0 },
          { x: 255, y: 255 },
        ],
      },
    })
    expect(layer.effects?.satin?.opacity).toBeCloseTo(0.62, 2)
    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.satin).toMatchObject({
      enabled: true,
      color: '#cc5c5c',
      blendMode: 'overlay',
      angle: -161,
      distance: 23,
      size: 31,
      invert: false,
      antialiased: true,
    })
    expect(back.satin.opacity).toBeCloseTo(0.62, 2)
  })

  it('bakes the PSD effect scale into editable sizes on import', () => {
    const styles = normalizeStyles({
      strokes: [{ enabled: true, size: 5, color: '#ffffff', position: 'outside', opacity: 1 }],
    })!
    const effects = { ...__psdStyleCodecForTests.exportStyles(styles), scale: 2 }
    const layer = readPsd(writePsd({ width: 4, height: 4, children: [{ name: 's', effects }] }), {
      useImageData: true,
    }).children![0]
    const back = __psdStyleCodecForTests.importStyles(layer)!
    expect(back.strokes[0].size).toBeCloseTo(10, 1)
  })
})
