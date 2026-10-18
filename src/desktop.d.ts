export {}
declare global {
  interface Window {
    fsh777?: { desktop: boolean; platform: string; onDownloadStatus: (callback: (status: { state: 'completed' | 'cancelled' | 'interrupted'; name: string }) => void) => () => void }
  }
}
