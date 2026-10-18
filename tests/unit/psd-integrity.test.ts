import { describe, it, expect } from 'vitest'
import { writePsd, initializeCanvas, readPsd } from 'ag-psd'
import { encodeProject, decodeProject } from '../../src/engine/psdMetadata'
import { sealProject, verifyProject } from '../../src/engine/psdIntegrity'
import { mergedOffset } from '../../src/engine/psdBinary'
initializeCanvas(
  () => {
    throw new Error('No DOM')
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
)
describe('Supplemental XMP integrity, never overriding external native edits', () => {
  it('seals a real PSD with UTF-8 XMP, survives decode, and does not mutate bytes during verification', async () => {
    const project = { version: 1, text: 'Кириллица' }
    const buffer = writePsd({
      width: 8,
      height: 8,
      imageResources: {
        xmpMetadata: encodeProject(project, '<rdf:RDF><custom>Шрифт</custom></rdf:RDF>'),
      },
      children: [
        {
          name: 'Native',
          text: {
            text: 'Text',
            shapeType: 'point',
            style: { font: { name: 'Manrope-Regular' }, fontSize: 20 },
          },
        },
      ],
    })
    await sealProject(buffer)
    const saved = new Uint8Array(buffer).slice()
    expect(await verifyProject(buffer)).toBe('valid')
    expect(new Uint8Array(buffer)).toEqual(saved)
    expect(
      decodeProject(readPsd(buffer, { useImageData: true }).imageResources?.xmpMetadata),
    ).toEqual(project)
    // Change a byte in native raster data, not the XMP. It must invalidate the private model.
    new Uint8Array(buffer)[mergedOffset(buffer) + 2] ^= 1
    expect(await verifyProject(buffer)).toBe('modified')
  })
  it('detects native edits with unchanged private XMP and distinguishes legacy files', async () => {
    const bytes = await sealProject(
      writePsd({
        width: 8,
        height: 8,
        imageResources: { xmpMetadata: encodeProject({ version: 1 }) },
        children: [{ name: 'Before' }],
      }),
    )
    const parsed = readPsd(bytes, { useImageData: true })
    parsed.children![0].name = 'After'
    expect(await verifyProject(writePsd(parsed))).toBe('modified')
    expect(await verifyProject(writePsd({ width: 8, height: 8 }))).toBe('legacy')
  })
})
