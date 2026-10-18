import { parseProject } from './document'
import type { EditorDocument } from '../types'
export interface RecentProject {
  id: string
  name: string
  width: number
  height: number
  savedAt: number
  thumbnail?: string
  document: EditorDocument
}
let stamp = Date.now(),
  pendingWrites = 0,
  lastCleanup = 0
export const reserveSaveStamp = () => (stamp = Math.max(Date.now(), stamp + 1))
export const hasPendingWrites = () => pendingWrites > 0
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fsh-777-local', 3)
    request.onupgradeneeded = () => {
      for (const store of ['projects', 'sources', 'fonts'])
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () =>
      reject(new Error('Закрой другую старую вкладку ФШ777 для обновления хранилища'))
  })
}
export async function readRecord<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  } finally {
    db.close()
  }
}
export async function writeRecord(store: string, key: string, value: unknown) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
export async function listRecords<T>(store: string): Promise<T[]> {
  const db = await openDatabase()
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
  } finally {
    db.close()
  }
}
/** Reservation time, not encode-completion time, orders saves. An old thumbnail job
 * finishing after a new edit must never overwrite the newer recovery snapshot. */
export async function saveDocument(
  doc: EditorDocument,
  thumbnail?: string,
  current = true,
  savedAt = reserveSaveStamp(),
) {
  pendingWrites++
  let db: IDBDatabase | undefined
  try {
    db = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction('projects', 'readwrite'),
        store = tx.objectStore('projects')
      if (current) {
        const latest = store.get('current-stamp')
        latest.onsuccess = () => {
          if (typeof latest.result !== 'number' || latest.result <= savedAt) {
            store.put(doc, 'current')
            store.put(savedAt, 'current-stamp')
          }
        }
      }
      const previous = store.get(`recent:${doc.id}`)
      previous.onsuccess = () => {
        if (previous.result?.savedAt > savedAt) return
        store.put(
          {
            id: doc.id,
            name: doc.name,
            width: doc.width,
            height: doc.height,
            savedAt,
            thumbnail: thumbnail || previous.result?.thumbnail,
            document: doc,
          } satisfies RecentProject,
          `recent:${doc.id}`,
        )
        const all = store.getAll()
        all.onsuccess = () => {
          const recent = (all.result as RecentProject[])
            .filter((v) => v?.document && Number.isFinite(v.savedAt))
            .sort((a, b) => b.savedAt - a.savedAt)
          for (const old of recent.slice(8)) store.delete(`recent:${old.id}`)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db?.close()
    pendingWrites--
  }
}
export async function loadDocument(): Promise<EditorDocument | null> {
  const value = await readRecord<EditorDocument>('projects', 'current')
  if (!value) return null
  const recent = await readRecord<RecentProject>('projects', `recent:${value.id}`)
  return parseProject(recent?.document || value)
}
export async function recentProjects(): Promise<RecentProject[]> {
  const records = await listRecords<RecentProject>('projects')
  const recent = records
    .filter((v) => v?.document && Number.isFinite(v.savedAt))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, 8)
  stamp = Math.max(stamp, ...recent.map((r) => r.savedAt))
  return recent
}
export async function forgetRecent(id: string) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite'),
        store = tx.objectStore('projects')
      store.delete(`recent:${id}`)
      const current = store.get('current')
      current.onsuccess = () => {
        if (current.result?.id === id) {
          store.delete('current')
          store.delete('current-stamp')
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
/** Retain sources referenced by recovery/recents; a one-day grace protects imports
 * that are still in a confirmation dialog. Cursor iteration avoids reading every PSD at once. */
export async function pruneSourceRecords(force = false) {
  if (!force && Date.now() - lastCleanup < 300000) return
  lastCleanup = Date.now()
  const db = await openDatabase(),
    referenced = new Set<string>()
  const collect = (doc: EditorDocument | undefined, depth = 0) => {
    if (!doc || depth > 3 || !Array.isArray(doc.layers)) return
    if (doc.sourceId) referenced.add(doc.sourceId)
    for (const layer of doc.layers.slice(0, 100)) collect(layer.smart, depth + 1)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['projects', 'sources'], 'readwrite'),
        all = tx.objectStore('projects').getAll()
      all.onsuccess = () => {
        for (const value of all.result) collect(value?.document || value)
        const cursor = tx.objectStore('sources').openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          if (!referenced.has(String(c.key)) && (c.value?.createdAt || 0) < Date.now() - 86400000)
            c.delete()
          c.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
