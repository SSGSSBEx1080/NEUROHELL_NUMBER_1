export {}
declare global {
  interface Window {
    fsh777?: { desktop: boolean; listFonts?: () => Promise<string[]>; platform: string; onDownloadStatus: (callback: (status: { state: 'completed' | 'cancelled' | 'interrupted'; name: string }) => void) => () => void }
  }
}
