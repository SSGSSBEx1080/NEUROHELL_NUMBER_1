import { useSyncExternalStore } from 'react'
import { installedFamilies, subscribeFonts } from '../engine/fonts'
export function useFonts() {
  return useSyncExternalStore(subscribeFonts, installedFamilies, installedFamilies)
}
