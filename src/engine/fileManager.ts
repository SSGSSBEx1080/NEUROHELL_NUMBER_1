import type { PsdExportReport } from './psdReport'
import type { EditorDocument } from '../types'
import { downloadBlob } from './render'
/** File orchestration stays separate from UI, history and the rendering engine. */
export class FileManager {
  static async save(document: EditorDocument, large = false, saveAs = false) {
    const { exportPsd } = await import('./psd')
    let report: PsdExportReport | undefined
    const blob = await exportPsd(document, large, 0, (summary) => {
      report = summary
    })
    const filename = await downloadBlob(
      blob,
      `${document.name.replace(/[\\/:*?"<>|]/g, '_')}.${large ? 'psb' : 'psd'}`,
      { documentId: document.id, saveAs },
    )
    return { blob, filename, report }
  }
}
