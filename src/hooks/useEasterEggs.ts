import { useEffect, useRef } from 'react'
const konami = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'KeyB',
  'KeyA',
]
/** UI-only secrets. Konami is accepted on Home so its arrow keys never nudge an artwork. */
export function useEasterEggs(home: boolean, activate: () => void) {
  const input = useRef<string[]>([]),
    sevens = useRef<number[]>([])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement)?.closest(
          'input,textarea,select,[contenteditable=true],[role=dialog]',
        )
      )
        return
      if (home) {
        input.current = [...input.current.slice(-9), e.code]
        if (konami.every((k, i) => input.current[i] === k)) {
          e.preventDefault()
          input.current = []
          activate()
          return
        }
      } else input.current = []
      if (e.code === 'Digit7') {
        const now = performance.now()
        sevens.current = [...sevens.current.filter((t) => now - t < 1500), now]
        if (sevens.current.length >= 3) {
          sevens.current = []
          activate()
        }
      } else sevens.current = []
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [home, activate])
}
