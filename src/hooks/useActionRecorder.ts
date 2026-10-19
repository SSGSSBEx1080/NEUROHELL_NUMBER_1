import { ACTION_DRAFT_KEY } from '../engine/actionStorage'
import { useEffect, useRef, useState } from 'react'
import type { Editor } from './useEditor'
import {
  recordEditorEvent,
  resumeRecording,
  startRecording,
  type Recording,
} from '../engine/actionRecorder'
import type { StudioAction } from '../engine/actions'
import { uid } from '../engine/document'
export function useActionRecorder(editor: Editor) {
  const [recording, setState] = useState<Recording | null>(null)
  const [storageError, setStorageError] = useState(false)
  const current = useRef(recording)
  const set = (value: Recording | null) => {
    current.current = value
    setState(value)
  }
  useEffect(
    () =>
      editor.subscribeEvents((event) => {
        const previous = current.current
        if (previous) {
          const next = recordEditorEvent(previous, event)
          if (next !== previous) set(next)
        }
      }),
    [editor.subscribeEvents],
  )
  useEffect(() => {
    if (!recording) return
    try {
      localStorage.setItem(
        ACTION_DRAFT_KEY,
        JSON.stringify({
          version: 2,
          actions: [{ name: recording.name, source: 'Черновик записи', steps: recording.steps }],
        }),
      )
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [recording])
  return {
    recording,
    storageError,
    start(name: string) {
      if (current.current) throw new Error('Запись уже идёт')
      editor.finish('Перед записью операции')
      set(startRecording(editor.documentRef.current, editor.snapshot().selectedId, name))
    },
    pause() {
      if (current.current) set({ ...current.current, paused: true })
    },
    resume() {
      if (current.current)
        set(
          resumeRecording(
            current.current,
            editor.documentRef.current,
            editor.snapshot().selectedId,
          ),
        )
    },
    stop(): StudioAction {
      editor.finish('Завершение записи')
      const value = current.current
      if (!value || !value.steps.length)
        throw new Error('Нет записанных шагов. Выполни изменение или отмени запись.')
      const action: StudioAction = {
        id: uid(),
        name: value.name,
        source: 'Запись 777',
        steps: value.steps,
      }
      set(null)
      return action
    },
    cancel() {
      set(null)
      try {
        localStorage.removeItem(ACTION_DRAFT_KEY)
      } catch {
        setStorageError(true)
      }
    },
  }
}
