/** Binary ICC embedding for flattened PNG/JPEG exports. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function asciiBytes(value: string): Uint8Array {
  return new Uint8Array([...value].map((char) => char.charCodeAt(0) & 0xff))
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined')
    throw new Error('Браузер не поддерживает сжатие ICC для PNG')
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(asciiBytes(type), 4)
  out.set(data, 8)
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)))
  return out
}

export async function embedPngIccProfile(
  input: Uint8Array,
  profileName: string,
  profile: Uint8Array,
): Promise<Uint8Array> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (input.length < 24 || signature.some((value, i) => input[i] !== value))
    throw new Error('PNG для встраивания ICC повреждён')
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
  const chunks: { type: string; bytes: Uint8Array }[] = []
  let offset = 8
  while (offset + 12 <= input.length) {
    const length = view.getUint32(offset)
    const total = length + 12
    if (length > input.length || offset + total > input.length)
      throw new Error('PNG для встраивания ICC обрезан')
    const type = String.fromCharCode(...input.subarray(offset + 4, offset + 8))
    chunks.push({ type, bytes: input.slice(offset, offset + total) })
    offset += total
    if (type === 'IEND') break
  }
  if (!chunks.length || chunks[0].type !== 'IHDR') throw new Error('В PNG нет заголовка IHDR')
  const kept = chunks.filter((chunk) => !['iCCP', 'sRGB', 'gAMA', 'cHRM'].includes(chunk.type))
  const safeName =
    profileName
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/\0/g, '')
      .slice(0, 79) || 'ICC'
  const data = concat([asciiBytes(safeName), new Uint8Array([0, 0]), await deflate(profile)])
  const icc = pngChunk('iCCP', data)
  return concat([
    input.slice(0, 8),
    kept[0].bytes,
    icc,
    ...kept.slice(1).map((chunk) => chunk.bytes),
  ])
}

export function embedJpegIccProfile(input: Uint8Array, profile: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8)
    throw new Error('JPEG для встраивания ICC повреждён')
  const segments: Uint8Array[] = []
  const chunkSize = 65519
  const count = Math.ceil(profile.length / chunkSize)
  if (count < 1 || count > 255) throw new Error('ICC слишком большой для JPEG APP2')
  for (let i = 0; i < count; i++) {
    const piece = profile.subarray(i * chunkSize, (i + 1) * chunkSize)
    const data = concat([asciiBytes('ICC_PROFILE'), new Uint8Array([0, i + 1, count]), piece])
    const segment = new Uint8Array(data.length + 4)
    segment[0] = 0xff
    segment[1] = 0xe2
    new DataView(segment.buffer).setUint16(2, data.length + 2)
    segment.set(data, 4)
    segments.push(segment)
  }

  const output: Uint8Array[] = [input.slice(0, 2), ...segments]
  let offset = 2
  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff) break
    const marker = input[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = new DataView(input.buffer, input.byteOffset + offset + 2, 2).getUint16(0)
    const total = length + 2
    if (length < 2 || offset + total > input.length)
      throw new Error('JPEG для встраивания ICC обрезан')
    const dataStart = offset + 4
    const isOldIcc =
      marker === 0xe2 &&
      length >= 16 &&
      String.fromCharCode(...input.subarray(dataStart, dataStart + 11)) === 'ICC_PROFILE' &&
      input[dataStart + 11] === 0
    if (!isOldIcc) output.push(input.slice(offset, offset + total))
    offset += total
  }
  output.push(input.slice(offset))
  return concat(output)
}
