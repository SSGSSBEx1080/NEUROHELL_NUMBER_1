/**
 * Minimal, bounds-checked PSD/PSB layer-record scanner.
 *
 * ag-psd intentionally exposes `knko` as a boolean. Photoshop uses byte 1
 * for Shallow and byte 2 for Deep, so the raw additional-info blocks are the
 * only honest way to distinguish and rewrite that depth. This scanner reads
 * just layer-record structure (channels, `lyid`, `lsct`, `knko`) and never
 * decodes channel pixels.
 */
export interface PsdLayerRecordInfo {
  /** Zero-based position in flattened PSD record order (bottom to top). */
  index: number
  /** Unicode `luni` layer name when present, otherwise the legacy Pascal name. */
  name: string
  /** Native PSD layer id from `lyid`, when present. */
  id?: number
  /** `lsct`/`lsdk` type: 0 layer, 1/2 group header, 3 group end. */
  sectionDividerType?: number
  /** Raw first byte of `knko`; Photoshop uses 0=None, 1=Shallow, 2=Deep. */
  knockoutByte?: number
  /** Absolute offset of that byte in the supplied buffer. */
  knockoutOffset?: number
  channelIds: number[]
  hasTransparencyChannel: boolean
  top: number
  left: number
  bottom: number
  right: number
}

const LARGE_ADDITIONAL_INFO_KEYS = new Set([
  // The keys whose additional-info length is 64-bit in PSB even without an
  // `8B64` signature (the same list ag-psd uses for its reader/writer).
  'LMsk',
  'Lr16',
  'Lr32',
  'Layr',
  'Mt16',
  'Mt32',
  'Mtrn',
  'Alph',
  'FMsk',
  'lnk2',
  'FEid',
  'FXid',
  'PxSD',
  'cinf',
])

const MAX_LAYER_RECORDS = 10000
const MAX_CHANNELS = 64

function signature(view: DataView, offset: number): string {
  if (offset < 0 || offset + 4 > view.byteLength) return ''
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

export function parsePsdLayerRecords(input: ArrayBuffer | Uint8Array): PsdLayerRecordInfo[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 26 || signature(view, 0) !== '8BPS')
    throw new Error('Некорректная подпись PSD/PSB')
  const version = view.getUint16(4)
  if (version !== 1 && version !== 2) throw new Error('Неподдерживаемая версия PSD/PSB')
  const large = version === 2
  let p = 26

  const need = (count: number, end = view.byteLength) => {
    if (!Number.isSafeInteger(count) || count < 0 || p + count > end)
      throw new Error('Обрезанная или повреждённая секция PSD')
  }
  const u8 = (end?: number) => {
    need(1, end)
    return view.getUint8(p++)
  }
  const u16 = (end?: number) => {
    need(2, end)
    const value = view.getUint16(p)
    p += 2
    return value
  }
  const i16 = (end?: number) => {
    need(2, end)
    const value = view.getInt16(p)
    p += 2
    return value
  }
  const u32 = (end?: number) => {
    need(4, end)
    const value = view.getUint32(p)
    p += 4
    return value
  }
  const i32 = (end?: number) => {
    need(4, end)
    const value = view.getInt32(p)
    p += 4
    return value
  }
  const length = (eightBytes: boolean, end?: number) => {
    if (!eightBytes) return u32(end)
    const high = u32(end)
    const low = u32(end)
    if (high !== 0) throw new Error('Секция PSD превышает поддерживаемые 4 ГиБ')
    return low
  }
  const skipSection = (eightBytes: boolean, end?: number) => {
    const size = length(eightBytes, end)
    need(size, end)
    p += size
    return size
  }

  skipSection(false) // Colour mode data.
  skipSection(false) // Image resources.
  const layerMaskSize = length(large)
  if (layerMaskSize === 0) return []
  need(layerMaskSize)
  const layerMaskEnd = p + layerMaskSize
  const layerInfoSize = length(large, layerMaskEnd)
  if (layerInfoSize === 0) return []
  need(layerInfoSize, layerMaskEnd)
  const layerInfoEnd = p + layerInfoSize

  const rawCount = i16(layerInfoEnd)
  const count = Math.abs(rawCount)
  if (count > MAX_LAYER_RECORDS) throw new Error('Слишком много записей слоёв PSD')
  const records: PsdLayerRecordInfo[] = []

  for (let index = 0; index < count; index++) {
    if (p >= layerInfoEnd) throw new Error('Обрезанные записи слоёв PSD')
    const top = i32(layerInfoEnd)
    const left = i32(layerInfoEnd)
    const bottom = i32(layerInfoEnd)
    const right = i32(layerInfoEnd)
    const channelCount = u16(layerInfoEnd)
    if (channelCount > MAX_CHANNELS) throw new Error('Некорректное число каналов слоя PSD')
    const channelIds: number[] = []
    for (let c = 0; c < channelCount; c++) {
      channelIds.push(i16(layerInfoEnd))
      // Channel data lengths are 64-bit in PSB layer records.
      length(large, layerInfoEnd)
    }
    need(12, layerInfoEnd)
    if (signature(view, p) !== '8BIM') throw new Error('Некорректная запись слоя PSD')
    p += 8 // `8BIM` + blend-mode signature.
    p += 4 // Opacity, clipping, flags and filler.

    const extraSize = u32(layerInfoEnd)
    need(extraSize, layerInfoEnd)
    const extraEnd = p + extraSize
    let name = ''
    let id: number | undefined
    let sectionDividerType: number | undefined
    let knockoutByte: number | undefined
    let knockoutOffset: number | undefined

    if (extraSize > 0) {
      skipSection(false, extraEnd) // Layer mask / adjustment data.
      if (p > extraEnd) throw new Error('Повреждённые дополнительные данные слоя PSD')
      skipSection(false, extraEnd) // Blending ranges.
      if (p > extraEnd) throw new Error('Повреждённые дополнительные данные слоя PSD')

      const nameLength = u8(extraEnd)
      need(nameLength, extraEnd)
      for (let i = 0; i < nameLength; i++) name += String.fromCharCode(bytes[p + i])
      p += nameLength
      // The Pascal name is nominally padded to a multiple of four, but some
      // writers are sloppy. Realign to the first additional-info signature,
      // as ag-psd does, instead of guessing a single padding rule.
      while (p + 4 <= extraEnd && signature(view, p) !== '8BIM' && signature(view, p) !== '8B64')
        p++

      while (extraEnd - p >= 12) {
        const sig = signature(view, p)
        if (sig !== '8BIM' && sig !== '8B64') {
          // Allow a zero-padded tail, reject other garbage rather than
          // accidentally treating random bytes as a knockout location.
          let tail = p
          while (tail < extraEnd && bytes[tail] === 0) tail++
          if (tail === extraEnd) {
            p = extraEnd
            break
          }
          throw new Error('Повреждённый блок дополнительной информации слоя PSD')
        }
        p += 4
        const key = signature(view, p)
        p += 4
        const eightBytes = sig === '8B64' || (large && LARGE_ADDITIONAL_INFO_KEYS.has(key))
        const dataSize = length(eightBytes, extraEnd)
        need(dataSize, extraEnd)
        const dataStart = p
        const dataEnd = dataStart + dataSize
        if (key === 'luni') {
          if (dataSize < 4) throw new Error('Повреждённый luni слоя PSD')
          const units = view.getUint32(dataStart)
          if (units > 4096 || 4 + units * 2 > dataSize)
            throw new Error('Повреждённый luni слоя PSD')
          let unicodeName = ''
          for (let i = 0; i < units; i++) {
            const code = view.getUint16(dataStart + 4 + i * 2)
            if (code !== 0) unicodeName += String.fromCharCode(code)
          }
          if (unicodeName) name = unicodeName
        } else if (key === 'lyid') {
          if (dataSize < 4) throw new Error('Повреждённый lyid слоя PSD')
          id = view.getUint32(dataStart)
        } else if (key === 'lsct' || key === 'lsdk') {
          if (dataSize < 4) throw new Error('Повреждённый lsct слоя PSD')
          sectionDividerType = view.getUint32(dataStart)
        } else if (key === 'knko') {
          if (dataSize < 1) throw new Error('Повреждённый knko слоя PSD')
          knockoutByte = view.getUint8(dataStart)
          knockoutOffset = dataStart
        }
        // Additional-info payloads are padded to an even byte count.
        p = dataEnd + (dataSize % 2)
        if (p > extraEnd) {
          if (dataEnd === extraEnd) p = extraEnd
          else throw new Error('Блок дополнительной информации PSD выходит за границы')
        }
      }
    }
    p = extraEnd
    records.push({
      index,
      name,
      id,
      sectionDividerType,
      knockoutByte,
      knockoutOffset,
      channelIds,
      hasTransparencyChannel: channelIds.includes(-1),
      top,
      left,
      bottom,
      right,
    })
  }
  return records
}

/**
 * Rewrite ag-psd's boolean Shallow marker (1) to Deep (2) for the exact PSD
 * layer ids supplied. Any ambiguity is an error: silently patching the
 * wrong record would corrupt a different layer's advanced blending.
 */
export function patchPsdDeepKnockout(buffer: ArrayBuffer, layerIds: Iterable<number>): ArrayBuffer {
  const ids = [...new Set(layerIds)]
  if (!ids.length) return buffer
  const records = parsePsdLayerRecords(buffer)
  const copy = new Uint8Array(buffer.slice(0))
  for (const id of ids) {
    const matches = records.filter((record) => record.id === id)
    if (matches.length !== 1)
      throw new Error(`PSD: не удалось однозначно записать Deep Knockout для слоя ${id}`)
    const record = matches[0]
    if (record.knockoutOffset === undefined || record.knockoutByte !== 1)
      throw new Error(`PSD: слой ${id} не содержит ожидаемый Shallow-маркер Knockout`)
    copy[record.knockoutOffset] = 2
  }
  return copy.buffer
}
