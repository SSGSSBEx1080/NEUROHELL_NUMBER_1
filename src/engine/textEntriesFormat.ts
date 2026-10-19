import type { TextEntry } from '../types'
export const MAX_TEXT_ENTRIES = 200
export const MAX_TEXT_ENTRY_LENGTH = 5000
/** Data only: a text collection never executes commands or makes network requests. */
export function parseTextEntries(input: unknown, legacy = false): TextEntry[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length > MAX_TEXT_ENTRIES)
    throw new Error('В документе допускается до 200 текстовых блоков')
  const ids = new Set<string>()
  return input.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Повреждённый текстовый блок')
    const v = value as Record<string, unknown>
    if (
      (!legacy && ('translation' in v || 'speaker' in v)) ||
      (legacy && ('text' in v || 'label' in v))
    )
      throw new Error('Неоднозначные поля текстового блока: проверь версию формата')
    const field = (key: string, max: number, label: string) => {
      if (v[key] === undefined) return ''
      if (typeof v[key] !== 'string' || v[key].length > max)
        throw new Error(`${label}: требуется текст до ${max} символов`)
      return v[key]
    }
    if (typeof v.id !== 'string' || !v.id || v.id.length > 100 || ids.has(v.id))
      throw new Error('ID текстовых блоков должны быть уникальными')
    ids.add(v.id)
    const states: Record<string, TextEntry['status']> = legacy
      ? { draft: 'draft', translated: 'ready', proofread: 'checked' }
      : { draft: 'draft', ready: 'ready', checked: 'checked' }
    if (typeof v.status !== 'string' || !Object.hasOwn(states, v.status))
      throw new Error('Неизвестный статус текстового блока')
    return {
      id: v.id,
      source: field('source', MAX_TEXT_ENTRY_LENGTH, 'Исходный текст'),
      text: field(legacy ? 'translation' : 'text', MAX_TEXT_ENTRY_LENGTH, 'Содержимое'),
      label: field(legacy ? 'speaker' : 'label', 100, 'Метка'),
      note: field('note', 2000, 'Заметка'),
      status: states[v.status],
      ...(typeof v.layerId === 'string' && v.layerId.length <= 100 ? { layerId: v.layerId } : {}),
    }
  })
}
/** Migrate old project data without changing user text, IDs, statuses or valid layer links. */
export function parseDocumentTextEntries(document: Record<string, unknown>) {
  if (document.textEntries !== undefined && document.script !== undefined)
    throw new Error(
      'В документе два разных поля списка текстов. Оставь один список, чтобы не потерять данные.',
    )
  return document.textEntries !== undefined
    ? parseTextEntries(document.textEntries)
    : parseTextEntries(document.script, true)
}
export function parseTextEntriesFile(input: unknown): TextEntry[] {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Нужен файл текстовых блоков .777texts.json')
  const file = input as Record<string, unknown>
  if (!['fsh777-texts', 'fsh777-script'].includes(String(file.format)) || file.version !== 1)
    throw new Error('Нужен файл текстовых блоков .777texts.json версии 1')
  const entries = parseTextEntries(file.entries, file.format === 'fsh777-script')
  if (!entries?.length) throw new Error('В файле нет текстовых блоков')
  // IDs and links belong to one document. External files never bind to coincidental IDs.
  return entries.map((entry) => ({ ...entry, id: crypto.randomUUID(), layerId: undefined }))
}
export function textEntriesFile(name: string, entries: TextEntry[]) {
  const safe = parseTextEntries(entries)!
  return JSON.stringify(
    {
      format: 'fsh777-texts',
      version: 1,
      document: name,
      entries: safe.map(({ layerId: _layerId, ...entry }) => entry),
    },
    null,
    2,
  )
}
