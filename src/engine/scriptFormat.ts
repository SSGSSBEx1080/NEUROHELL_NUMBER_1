import type { TranslationEntry } from '../types'
export const MAX_SCRIPT_ENTRIES = 200
export const MAX_SCRIPT_TEXT = 5000
/** Deliberately data-only. A script is not code and never triggers translation/network requests. */
export function parseScript(input: unknown): TranslationEntry[] | undefined {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length > MAX_SCRIPT_ENTRIES)
    throw new Error('В сценарии допускается до 200 реплик')
  const ids = new Set<string>()
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Повреждённая реплика')
    const v = value as Record<string, unknown>
    const field = (key: string, max: number) => {
      if (v[key] === undefined) return ''
      if (typeof v[key] !== 'string' || (v[key] as string).length > max)
        throw new Error(`Поле ${key}: требуется текст до ${max} символов`)
      return v[key] as string
    }
    if (typeof v.id !== 'string' || !v.id || v.id.length > 100 || ids.has(v.id))
      throw new Error('ID реплик должны быть уникальными')
    ids.add(v.id)
    if (v.status !== 'draft' && v.status !== 'translated' && v.status !== 'proofread')
      throw new Error('Неизвестный статус перевода')
    return {
      id: v.id,
      source: field('source', MAX_SCRIPT_TEXT),
      translation: field('translation', MAX_SCRIPT_TEXT),
      speaker: field('speaker', 100),
      note: field('note', 2000),
      status: v.status,
      ...(typeof v.layerId === 'string' && v.layerId.length <= 100 ? { layerId: v.layerId } : {}),
    }
  })
}
export function parseScriptFile(input: unknown): TranslationEntry[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !('format' in input) ||
    input.format !== 'fsh777-script' ||
    !('version' in input) ||
    input.version !== 1 ||
    !('entries' in input)
  )
    throw new Error('Нужен сценарий .777script.json версии 1')
  const entries = parseScript(input.entries)
  if (!entries?.length) throw new Error('В файле нет реплик')
  // IDs and links belong to a page, not an imported interchange file. Never bind to a coincidental ID.
  return entries.map((e) => ({ ...e, id: crypto.randomUUID(), layerId: undefined }))
}
export function scriptFile(name: string, entries: TranslationEntry[]) {
  return JSON.stringify(
    {
      format: 'fsh777-script',
      version: 1,
      document: name,
      entries: entries.map(({ layerId: _layerId, ...entry }) => entry),
    },
    null,
    2,
  )
}
