import { expect, it } from 'vitest'
import { buildIccProfile, builtinColorProfile } from '../../src/engine/colorProfiles'
import { embedJpegIccProfile, embedPngIccProfile } from '../../src/engine/imageIcc'

function chunk(type: string, data: number[]): Uint8Array {
  const out = new Uint8Array(data.length + 12)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  )
  out.set(data, 8)
  return out
}

it('embeds a compressed iCCP chunk into PNG and removes shortcuts that conflict with it', async () => {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const png = new Uint8Array([
    ...signature,
    ...chunk('IHDR', new Array(13).fill(0)),
    ...chunk('sRGB', [0]),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ])
  const profile = buildIccProfile(builtinColorProfile('adobe-rgb-1998')!)
  const output = await embedPngIccProfile(png, 'Adobe RGB (1998)', profile)
  const text = Buffer.from(output).toString('latin1')
  expect(text).toContain('iCCP')
  expect(text).not.toContain('sRGB')
  const iccAt = text.indexOf('iCCP')
  const size = new DataView(output.buffer, output.byteOffset + iccAt - 4, 4).getUint32(0)
  const payload = output.subarray(iccAt + 4, iccAt + 4 + size)
  const nameEnd = payload.indexOf(0)
  const inflated = new Uint8Array(
    await new Response(
      new Blob([payload.subarray(nameEnd + 2).slice()])
        .stream()
        .pipeThrough(new DecompressionStream('deflate')),
    ).arrayBuffer(),
  )
  expect([...inflated]).toEqual([...profile])
})

it('embeds APP2 ICC segments into JPEG', () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xda, 0x00, 0x02, 0x11,
  ])
  const profile = buildIccProfile(builtinColorProfile('sgray')!)
  const output = embedJpegIccProfile(jpeg, profile)
  expect(output[2]).toBe(0xff)
  expect(output[3]).toBe(0xe2)
  expect(Buffer.from(output).toString('latin1')).toContain('ICC_PROFILE')
  const length = new DataView(output.buffer, output.byteOffset + 4, 2).getUint16(0)
  expect(length).toBe(profile.length + 16)
})
