import { parseProject } from './document'
import type { EditorDocument } from '../types'
export interface RecentProject { id: string; name: string; width: number; height: number; savedAt: number; thumbnail?: string; document: EditorDocument }
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fsh-777-local', 3)
    request.onupgradeneeded = () => { for (const store of ['projects', 'sources', 'fonts']) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Закрой другую старую вкладку ФШ777 для обновления хранилища'))
  })
}
export async function readRecord<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase()
  try { return await new Promise<T | undefined>((resolve, reject) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) } finally { db.close() }
}
export async function writeRecord(store: string, key: string, value: unknown) {
  const db = await openDatabase()
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value, key); tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error) }) } finally { db.close() }
}
export async function listRecords<T>(store: string): Promise<T[]> {
  const db = await openDatabase()
  try { return await new Promise<T[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) } finally { db.close() }
}
export async function saveDocument(doc: EditorDocument, thumbnail?: string) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects')
      store.put(doc, 'current')
      store.put({ id: doc.id, name: doc.name, width: doc.width, height: doc.height, savedAt: Date.now(), thumbnail, document: doc } satisfies RecentProject, `recent:${doc.id}`)
      const all = store.getAll()
      all.onsuccess = () => {
        const recent = (all.result as RecentProject[]).filter(v => v.document).sort((a, b) => b.savedAt - a.savedAt)
        for (const old of recent.slice(8)) store.delete(`recent:${old.id}`)
      }
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function loadDocument(): Promise<EditorDocument | null> {
  const value = await readRecord('projects', 'current')
  return value ? parseProject(value) : null
}
export async function recentProjects(): Promise<RecentProject[]> {
  const records = await listRecords<RecentProject>('projects')
  return records.filter(v => v.document && Number.isFinite(v.savedAt)).sort((a, b) => b.savedAt - a.savedAt).slice(0, 8)
}
