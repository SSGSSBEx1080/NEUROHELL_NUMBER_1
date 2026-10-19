/** Exact local assets only. Old references are user-document compatibility, never
 * start-screen recommendations. Do not substitute another picture in a saved document. */
const legacyImage = { source: '/compat/legacy-illustration.webp', width: 896, height: 1200 }
const assets: Record<string, { source: string; width: number; height: number }> = {
  '/demo-landscape.webp': { source: '/demo-landscape.webp', width: 1312, height: 816 },
  '/demo-layout.webp': legacyImage,
  '/demo-manga.webp': legacyImage,
  '/compat/legacy-illustration.webp': legacyImage,
}
export function bundledAsset(source: string) {
  return Object.hasOwn(assets, source) ? assets[source] : undefined
}
export function isBundledRaster(source: string) {
  return !!bundledAsset(source)
}
export const bundledImageSource = (source: string) => bundledAsset(source)?.source || source
