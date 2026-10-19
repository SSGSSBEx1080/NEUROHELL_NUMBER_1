export {}
declare global {
  interface Window {
    fsh777?: {
      desktop: boolean
      saveFile?: (value: {
        name: string
        bytes: Uint8Array
        documentId?: string
        saveAs?: boolean
      }) => Promise<{
        state: 'completed' | 'cancelled' | 'interrupted'
        name: string
        message?: string
      }>
      chooseBatchFolder?: () => Promise<{
        state: 'completed' | 'cancelled'
        id?: string
        name: string
      }>
      saveBatchFile?: (value: { folderId: string; name: string; bytes: Uint8Array }) => Promise<{
        state: 'completed' | 'cancelled' | 'interrupted'
        name: string
        message?: string
      }>
      listFonts?: () => Promise<string[]>
      platform: string
      onDownloadStatus: (
        callback: (status: {
          state: 'completed' | 'cancelled' | 'interrupted'
          name: string
        }) => void,
      ) => () => void
    }
  }
}
