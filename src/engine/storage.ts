import { parseProject } from './document'
import type { EditorDocument } from '../types'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fsh-777-local', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveDocument(doc: EditorDocument) {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put(doc, 'current')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function loadDocument(): Promise<EditorDocument | null> {
  const db = await openDatabase()
  try {
    return await new Promise<EditorDocument | null>((resolve, reject) => {
      const request = db.transaction('projects', 'readonly').objectStore('projects').get('current')
      request.onsuccess = () => {
        try { resolve(request.result ? parseProject(request.result) : null) } catch { resolve(null) }
      }
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
