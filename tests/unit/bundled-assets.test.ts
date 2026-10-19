import { expect, it } from 'vitest'
import { bundledAsset, bundledImageSource, isBundledRaster } from '../../src/engine/bundledAssets'
import { sourceDimensions } from '../../src/engine/imageSafety'
import { readFileSync, existsSync } from 'node:fs'
it('loads historical image references only through a fixed compatibility asset, without replacing their content', () => {
  for (const source of [
    '/demo-layout.webp',
    '/demo-manga.webp',
    '/compat/legacy-illustration.webp',
  ]) {
    expect(bundledImageSource(source)).toBe('/compat/legacy-illustration.webp')
    expect(sourceDimensions(source)).toEqual({ width: 896, height: 1200 })
  }
  expect(existsSync('public/demo-layout.webp')).toBe(false)
  expect(readFileSync('public/compat/legacy-illustration.webp').subarray(0, 4).toString()).toBe(
    'RIFF',
  )
  for (const source of [
    '__proto__',
    'https://example.org/image.png',
    '/compat/../secret',
    '/compat/unknown.png',
  ]) {
    expect(isBundledRaster(source)).toBe(false)
    expect(bundledAsset(source)).toBeUndefined()
  }
})
