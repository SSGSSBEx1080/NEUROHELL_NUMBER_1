// Reproducible CPU algorithm benchmark, NOT an Adobe comparison or a Windows/UI benchmark.
// Usage: node --expose-gc scripts/benchmark-filters.mjs [width] [height]
import { build } from 'esbuild'
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
const width = Number(process.argv[2] || 2048),
  height = Number(process.argv[3] || 1024)
if (
  !Number.isInteger(width) ||
  !Number.isInteger(height) ||
  width < 1 ||
  height < 1 ||
  width > 4096 ||
  height > 4096 ||
  width * height > 8_388_608
)
  throw new Error('Expected dimensions <= 4096 and <= 8 Mp')
const compiled = await build({
  entryPoints: ['src/engine/rasterFilters.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
})
const { processRasterFilter } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
)
const pixels = new Uint8ClampedArray(width * height * 4)
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    pixels[i] = x % 256
    pixels[i + 1] = y % 256
    pixels[i + 2] = (x * 13 + y * 7) % 256
    pixels[i + 3] = (x + y) % 7 ? 255 : 128
  }
const cases = [
  { type: 'unsharp', radius: 30, amount: 200, threshold: 3 },
  { type: 'highpass', radius: 30 },
  { type: 'median', radius: 5 },
  { type: 'noise', amount: 12, distribution: 'gaussian', monochrome: false, seed: 777 },
  { type: 'mosaic', size: 16 },
  { type: 'edges', strength: 1 },
]
const rows = []
for (const filter of cases) {
  global.gc?.()
  const start = performance.now(),
    result = processRasterFilter({ width, height, pixels, filter }),
    ms = performance.now() - start
  let checksum = 0,
    alphaErrors = 0
  for (let i = 0; i < result.length; i += 4) {
    checksum = (checksum + result[i] + result[i + 1] * 3 + result[i + 2] * 7) >>> 0
    if (result[i + 3] !== pixels[i + 3]) alphaErrors++
  }
  if (alphaErrors) throw new Error(`${filter.type}: alpha changed`)
  const row = {
    filter: filter.type,
    milliseconds: Math.round(ms),
    alphaErrors,
    checksum,
    processArrayBuffersMiB: Math.round(process.memoryUsage().arrayBuffers / 1048576),
  }
  rows.push(row)
  console.log(JSON.stringify(row))
}
const report = {
  scope:
    'Synthetic pixels, Node CPU in the current sandbox; not Windows timings, end-to-end UI timings, or Photoshop parity.',
  node: process.version,
  platform: process.platform,
  width,
  height,
  rows,
}
await mkdir('test-results', { recursive: true })
await writeFile(
  `test-results/filter-benchmark-${width}x${height}.json`,
  JSON.stringify(report, null, 2),
)
