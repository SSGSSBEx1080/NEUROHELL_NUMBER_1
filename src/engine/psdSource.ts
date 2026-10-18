import type { EditorDocument } from '../types'
import { readRecord, writeRecord } from './storage'
export interface PsdSource { id: string; bytes: ArrayBuffer; baseline: EditorDocument; composite?: string; psb: boolean }
const sources = new Map<string, PsdSource>()
const ignoredVisual = new Set(['name', 'locked', 'expanded', 'sourcePath', 'sourceId', 'id', 'dpi'])
const ignoredSave = new Set(['sourceId', 'expanded'])
function equal(a: unknown, b: unknown, ignored: Set<string>): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const key of keys) if (!ignored.has(key) && !equal(x[key], y[key], ignored)) return false
  return true
}
export const sameVisual = (a: unknown, b: unknown) => equal(a, b, ignoredVisual)
export function originalSource(doc: EditorDocument) { return doc.sourceId ? sources.get(doc.sourceId) : undefined }
export function isOriginalAppearance(doc: EditorDocument) {
  const s = originalSource(doc); return !!s && sameVisual(doc, s.baseline)
}
export function isOriginalDocument(doc: EditorDocument) {
  const s = originalSource(doc); return !!s && equal({ ...doc, name: '' }, { ...s.baseline, name: '' }, ignoredSave)
}
function remember(source: PsdSource) {
  sources.delete(source.id); sources.set(source.id, source)
  let size = [...sources.values()].reduce((sum, v) => sum + v.bytes.byteLength, 0)
  for (const [id, value] of sources) { if (size <= 160 * 1024 * 1024 && sources.size <= 4) break; if (id !== source.id) { sources.delete(id); size -= value.bytes.byteLength } }
  return source
}
export async function registerSource(source: PsdSource) {
  remember(source)
  try { await writeRecord('sources', source.id, source) } catch { /* The live source stays usable even if persistent storage is full. */ }
}
export async function prepareSource(doc: EditorDocument) {
  if (!doc.sourceId) return
  if (sources.has(doc.sourceId)) return sources.get(doc.sourceId)
  const source = await readRecord<PsdSource>('sources', doc.sourceId)
  if (source?.bytes instanceof ArrayBuffer) return remember(source)
}
