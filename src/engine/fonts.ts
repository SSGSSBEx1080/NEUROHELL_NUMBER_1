import names from './fontNames.json'
import catalog from './fontCatalog.json'
import { listRecords, openDatabase, writeRecord } from './storage'
export { catalog as fontCatalog }
export interface FontRecord {
  id: string
  family: string
  postscriptName: string
  weight: string
  style: string
  source: 'file' | 'google'
  data: ArrayBuffer
  license?: string
}
export const bundledFamilies = [
  'Manrope',
  'Unbounded',
  ...catalog.filter((f) => f.bundled).map((f) => f.family),
]
const systemFamilies = new Set([
  ...bundledFamilies,
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Segoe UI',
  'monospace',
])
let families = [...systemFamilies]
let records: FontRecord[] = []
const faces = new Map<string, FontFace>(),
  listeners = new Set<() => void>()
const emit = () => {
  families = [...new Set([...systemFamilies, ...records.map((f) => f.family)])].sort((a, b) =>
    a.localeCompare(b),
  )
  for (const fn of listeners) fn()
  window.dispatchEvent(new Event('fsh777-fonts-changed'))
}
export const subscribeFonts = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export const installedFamilies = () => families
export const importedFonts = () => records
/** Bounded SFNT name-table parser: metadata only, rendering/parsing of outlines stays in the browser sandbox. */
export function fontInfo(data: ArrayBuffer, fallback: string) {
  if (data.byteLength < 12 || data.byteLength > 16 * 1024 * 1024)
    throw new Error('Шрифт должен быть от 12 байт до 16 МиБ')
  const v = new DataView(data),
    signature = v.getUint32(0)
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(signature))
    throw new Error(
      'Поддерживаются обычные файлы TTF и OTF; коллекции TTC и веб-шрифты не принимаются',
    )
  const count = v.getUint16(4)
  if (count > 512 || 12 + count * 16 > data.byteLength)
    throw new Error('Повреждённая таблица шрифта')
  let family = fallback,
    postscriptName = fallback,
    weight = '400',
    style = 'normal'
  let variable = false
  const names: { id: number; text: string; score: number }[] = []
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16,
      tag = v.getUint32(at),
      offset = v.getUint32(at + 8),
      length = v.getUint32(at + 12)
    if (offset + length > data.byteLength)
      throw new Error('Таблица шрифта выходит за границы файла')
    if (tag === 0x66766172) variable = true
    if (tag === 0x4f532f32 && length >= 64) {
      weight = String(Math.max(100, Math.min(900, v.getUint16(offset + 4))))
      style = v.getUint16(offset + 62) & 1 ? 'italic' : 'normal'
    }
    if (tag !== 0x6e616d65 || length < 6) continue
    const n = v.getUint16(offset + 2),
      start = offset + v.getUint16(offset + 4)
    if (n > 4096 || 6 + n * 12 > length) throw new Error('Повреждённые названия шрифта')
    for (let j = 0; j < n; j++) {
      const at = offset + 6 + j * 12,
        platform = v.getUint16(at),
        language = v.getUint16(at + 4),
        id = v.getUint16(at + 6),
        size = v.getUint16(at + 8),
        from = start + v.getUint16(at + 10)
      if (![1, 6, 16].includes(id) || size > 1024 || from + size > offset + length) continue
      const text = new TextDecoder(platform === 0 || platform === 3 ? 'utf-16be' : 'windows-1252')
        .decode(new Uint8Array(data, from, size))
        .replace(/\0/g, '')
        .trim()
      if (text && text.length <= 160 && !/[\x00-\x1f";{}<>]/.test(text))
        names.push({ id, text, score: (language === 1033 ? 10 : 0) + (platform === 3 ? 3 : 0) })
    }
  }
  names.sort((a, b) => b.score - a.score)
  family = names.find((n) => n.id === 16)?.text || names.find((n) => n.id === 1)?.text || fallback
  postscriptName = names.find((n) => n.id === 6)?.text || family
  return { family, postscriptName, weight: variable ? '100 900' : weight, style }
}
async function activate(record: FontRecord) {
  const previous = faces.get(record.id)
  const face = new FontFace(record.family, record.data, {
    weight: record.weight,
    style: record.style,
  })
  await face.load()
  document.fonts.add(face)
  faces.set(record.id, face)
  if (previous) document.fonts.delete(previous)
}
export async function restoreFonts() {
  try {
    records = await listRecords<FontRecord>('fonts')
    await Promise.all(records.map((r) => activate(r).catch(() => {})))
    emit()
  } catch {
    /* System and bundled fonts still work. */
  }
}
export async function installFont(
  data: ArrayBuffer,
  filename: string,
  source: FontRecord['source'] = 'file',
  license?: string,
) {
  const info = fontInfo(data, filename.replace(/\.(ttf|otf)$/i, ''))
  const id = `${info.postscriptName}:${info.style}`,
    previous = records.find((r) => r.id === id),
    prior = records.filter((r) => r.id !== id)
  if (
    prior.length >= 64 ||
    prior.reduce((n, r) => n + r.data.byteLength, data.byteLength) > 64 * 1024 * 1024
  )
    throw new Error('Локальная библиотека ограничена 64 шрифтами / 64 МиБ. Удали ненужные шрифты.')
  const record: FontRecord = { id, ...info, data, source, license }
  await activate(record)
  try {
    await writeRecord('fonts', id, record)
  } catch {
    document.fonts.delete(faces.get(id)!)
    faces.delete(id)
    if (previous) await activate(previous)
    throw new Error('Шрифт не сохранён: локальное хранилище недоступно или переполнено')
  }
  records = [...prior, record]
  emit()
  return record
}
export async function removeFont(id: string) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('fonts', 'readwrite')
      tx.objectStore('fonts').delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
  if (faces.has(id)) document.fonts.delete(faces.get(id)!)
  faces.delete(id)
  records = records.filter((r) => r.id !== id)
  emit()
}
export async function loadSystemFonts() {
  let names: string[]
  if (window.fsh777?.listFonts) names = await window.fsh777.listFonts()
  else {
    const browser = window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }
    if (!browser.queryLocalFonts)
      throw new Error(
        'Этот браузер не перечисляет системные шрифты. Используй настольное приложение или загрузи TTF/OTF.',
      )
    try {
      names = (await browser.queryLocalFonts()).map((f) => f.family)
    } catch {
      throw new Error(
        'Доступ к системным шрифтам не разрешён. Дай разрешение в браузере или загрузи TTF/OTF вручную.',
      )
    }
  }
  for (const n of names) if (n.length <= 160 && !/[\x00-\x1f";{}<>]/.test(n)) systemFamilies.add(n)
  emit()
  return names.length
}
async function githubFile(path: string): Promise<ArrayBuffer> {
  const request = async (url: string) => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30000),
      credentials: 'omit',
    }).catch(() => {
      throw new Error(
        'Не удалось связаться с каталогом шрифтов. Проверь интернет и сертификат подключения или загрузи TTF/OTF вручную.',
      )
    })
    if (!response.ok)
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GitHub ограничил запросы шрифтов. Повтори позже или загрузи TTF вручную.'
          : 'Не удалось загрузить шрифт: проверь подключение',
      )
    return response.json()
  }
  let value = await request(
    `https://api.github.com/repos/google/fonts/contents/${path.split('/').map(encodeURIComponent).join('/')}`,
  )
  if (value.size > 16 * 1024 * 1024) throw new Error('Слишком большой шрифт')
  if (!value.content && /^[a-f\d]{40}$/i.test(value.sha))
    value = await request(`https://api.github.com/repos/google/fonts/git/blobs/${value.sha}`)
  if (typeof value.content !== 'string' || value.content.length > 24 * 1024 * 1024)
    throw new Error('Неожиданный ответ библиотеки шрифтов')
  const text = atob(value.content.replace(/\s/g, ''))
  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer
}
export async function installGoogleFont(id: string) {
  const item = catalog.find((f) => f.id === id)
  if (!item) throw new Error('Неизвестный шрифт каталога')
  const [data, license] = await Promise.all([githubFile(item.path), githubFile(item.licensePath)])
  return installFont(data, item.family, 'google', new TextDecoder().decode(license))
}
export async function useFont(family: string) {
  await document.fonts.load(`500 32px "${family.replace(/["\\]/g, '')}"`)
  window.dispatchEvent(new Event('fsh777-fonts-changed'))
}
/** Use actual OpenType PostScript names, not a CSS family label. Font files still
 * must be installed in the receiving editor; PSD never embeds these font binaries. */
export function nativeFontStyle(family: string, weight = 400, italic = false) {
  const faces = records.filter((r) => r.family === family),
    wantedStyle = italic ? 'italic' : 'normal'
  const match = faces
    .filter((r) => r.style === wantedStyle)
    .sort(
      (a, b) =>
        Math.abs(Number(a.weight.split(' ')[0]) - weight) -
        Math.abs(Number(b.weight.split(' ')[0]) - weight),
    )[0]
  const known = (names as Record<string, { default: string; weights: Record<string, string> }>)[
    family
  ]
  const chosen =
    known &&
    Object.keys(known.weights)
      .map(Number)
      .sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight))[0]
  const fallback = match || (!known ? faces[0] : undefined)
  const nativeWeight = fallback ? Number(fallback.weight.split(' ')[0]) : chosen || 400
  return {
    font: {
      name:
        fallback?.postscriptName ||
        (chosen && known?.weights[String(chosen)]) ||
        known?.default ||
        family,
    },
    fauxBold: weight >= 700 && nativeWeight < 700,
    fauxItalic: italic && fallback?.style !== 'italic',
  }
}
