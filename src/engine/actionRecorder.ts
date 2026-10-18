import type { EditorDocument, Layer } from '../types'
import type { EditorEvent } from './editorEvents'
import { isLayerLocked } from './document'
import { parseActionCommand, parseActionProperties, type ActionProperties } from './actionSchema'
import type { ActionStep } from './actions'
export interface Recording {
  name: string
  documentId: string
  activeId: string | null
  steps: ActionStep[]
  paused: boolean
  warning?: string
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((key) => equal(x[key], y[key]))
}
const unsupported = (name: string, reason: string): ActionStep => ({
  name,
  enabled: true,
  unsupported: reason,
})
const step = (name: string, command: unknown): ActionStep => {
  const parsed = parseActionCommand(command)
  if (!parsed) throw new Error('Команда пока не записывается')
  return { name, enabled: true, command: parsed }
}
export function startRecording(
  doc: EditorDocument,
  selectedId: string | null,
  name: string,
): Recording {
  if (!selectedId || !doc.layers.some((l) => l.id === selectedId) || isLayerLocked(doc, selectedId))
    throw new Error('Для записи выбери незаблокированный слой')
  return {
    name: name.trim().slice(0, 100) || 'Моя операция',
    documentId: doc.id,
    activeId: selectedId,
    steps: [],
    paused: false,
  }
}
function changeSteps(before: Layer, after: Layer, label: string): ActionStep[] {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !equal(before[key as keyof Layer], after[key as keyof Layer]) && key !== 'expanded',
  )
  if (!changed.length) return []
  if (before.kind === 'group' || before.locked)
    throw new Error('Изменения групп и заблокированных слоёв пока не записываются')
  const geometry = ['x', 'y', 'width', 'height', 'rotation']
  const values: Record<string, unknown> = {},
    result: ActionStep[] = []
  for (const key of changed) {
    if (geometry.includes(key) || key === 'adjustments') continue
    if (key === 'mask') {
      const mask = before.mask
      if (
        !mask?.linked ||
        !after.mask ||
        !equal(after.mask, {
          ...mask,
          x: after.x + (mask.x - before.x) * (after.width / before.width),
          y: after.y + (mask.y - before.y) * (after.height / before.height),
          width: (mask.width * after.width) / before.width,
          height: (mask.height * after.height) / before.height,
        })
      )
        throw new Error('Редактирование маски не записано; геометрическая связь поддерживается')
      continue
    }
    values[key] =
      after[key as keyof Layer] ?? (key === 'styles' || key === 'textFrame' ? null : undefined)
  }
  const properties = parseActionProperties(values)
  if (changed.some((k) => geometry.includes(k)))
    result.push(
      step(`${label} · геометрия`, {
        type: 'transform',
        dx: after.x - before.x,
        dy: after.y - before.y,
        scaleX: after.width / before.width,
        scaleY: after.height / before.height,
        angle: after.rotation - before.rotation,
      }),
    )
  if (changed.includes('adjustments'))
    result.push(
      step(`${label} · цвет`, {
        type: 'adjust',
        values: Object.fromEntries(
          Object.entries(after.adjustments).filter(
            ([key, value]) => before.adjustments[key as keyof typeof before.adjustments] !== value,
          ),
        ),
      }),
    )
  if (Object.keys(properties).length)
    result.push(step(label, { type: 'properties', values: properties }))
  return result
}
function targetSteps(recording: Recording, doc: EditorDocument, id: string): ActionStep[] {
  if (recording.activeId === id) return []
  const old = doc.layers.findIndex((l) => l.id === recording.activeId),
    target = doc.layers.findIndex((l) => l.id === id)
  if (old < 0 || target < 0)
    throw new Error('Нельзя записать выбор слоя после удаления цели; заверши операцию')
  return [step('Выбор слоя относительно активного', { type: 'select', offset: target - old })]
}
export function recordEditorEvent(recording: Recording, event: EditorEvent): Recording {
  if (recording.paused) return recording
  let steps: ActionStep[] = [],
    activeId = recording.activeId
  const doc = event.type === 'commit' ? event.after : event.document
  if (doc.id !== recording.documentId)
    return append(
      recording,
      [
        unsupported(
          'Смена документа',
          'Запись приостановлена: операции между документами не поддерживаются',
        ),
      ],
      activeId,
      true,
    )
  try {
    if (event.type === 'history')
      throw new Error(
        'Undo/redo и переход по истории не записываются. Удали этот шаг или запиши последовательность заново.',
      )
    if (event.type === 'document') return recording
    if (event.type === 'selection') {
      if (!event.selectedId) return recording // Clearing a selection is navigation, not a pixel command.
      steps = targetSteps(recording, doc, event.selectedId)
      activeId = event.selectedId
    } else {
      const before = event.before,
        after = event.after
      if (!equal({ ...before, layers: undefined }, { ...after, layers: undefined }))
        throw new Error('Свойства документа и сценарий перевода не записываются')
      const added = after.layers.filter((l) => !before.layers.some((p) => p.id === l.id)),
        removed = before.layers.filter((l) => !after.layers.some((p) => p.id === l.id))
      const changed = before.layers.filter((l) => {
        const next = after.layers.find((p) => p.id === l.id)
        return next && !equal({ ...l, expanded: undefined }, { ...next, expanded: undefined })
      })
      if (added.length === 1 && !removed.length && !changed.length) {
        const original = before.layers.find((l) => l.id === activeId),
          copy = added[0]
        if (!original || original.kind === 'group')
          throw new Error('Создание слоёв/групп и растровые операции пока не записываются')
        // Recognize actual duplication, never mistake unrelated raster creation for a duplicate.
        const dx = copy.x - original.x,
          dy = copy.y - original.y
        const comparable = {
          ...copy,
          id: original.id,
          name: original.name,
          x: original.x,
          y: original.y,
          mask: copy.mask ? { ...copy.mask, x: copy.mask.x - dx, y: copy.mask.y - dy } : undefined,
        }
        if (!equal(comparable, original) || copy.name !== `${original.name} — копия`)
          throw new Error(
            'Добавление нового содержимого не записано. Дублирование существующего слоя поддерживается.',
          )
        steps = [step(event.label, { type: 'duplicate', offset: { x: dx, y: dy } })]
        activeId = copy.id
      } else if (removed.length === 1 && !added.length && !changed.length) {
        steps = [
          ...targetSteps(recording, before, removed[0].id),
          step(event.label, { type: 'delete' }),
        ]
        activeId = null
      } else if (!added.length && !removed.length && changed.length <= 1) {
        if (
          !equal(
            before.layers.map((l) => l.id),
            after.layers.map((l) => l.id),
          )
        )
          throw new Error('Изменение порядка слоёв пока не записывается')
        if (changed.length) {
          const old = changed[0],
            next = after.layers.find((l) => l.id === old.id)!
          steps = [
            ...targetSteps(recording, before, old.id),
            ...changeSteps(old, next, event.label),
          ]
          activeId = old.id
        }
      } else throw new Error('Изменение нескольких слоёв, групп или растров не записано')
    }
  } catch (e) {
    steps = [
      unsupported(
        event.type === 'commit' ? event.label : 'Навигация при записи',
        e instanceof Error ? e.message : 'Действие не поддерживается',
      ),
    ]
  }
  return steps.length ? append(recording, steps, activeId) : recording
}
function append(
  recording: Recording,
  steps: ActionStep[],
  activeId: string | null,
  paused = false,
): Recording {
  const all = [...recording.steps, ...steps]
  if (all.length > 200)
    return {
      ...recording,
      activeId,
      paused: true,
      steps: [
        ...all.slice(0, 199),
        unsupported(
          'Лимит записи',
          'Достигнут предел 200 шагов. Продолжение не записано; сценарий заблокирован.',
        ),
      ],
      warning: 'Достигнут предел записи — останови и проверь шаги',
    }
  if (all.length === 200)
    return {
      ...recording,
      activeId,
      steps: all,
      paused: true,
      warning: 'Достигнут предел 200 шагов — запись приостановлена',
    }
  const warning = steps.find((s) => s.unsupported)?.unsupported
  return { ...recording, activeId, steps: all, paused, warning: warning || recording.warning }
}
export function resumeRecording(
  recording: Recording,
  doc: EditorDocument,
  selectedId: string | null,
) {
  if (recording.steps.length >= 200)
    throw new Error('Достигнут предел 200 шагов. Сохрани эту запись и начни следующую.')
  if (doc.id !== recording.documentId)
    throw new Error('Вернись в исходный документ, чтобы продолжить запись')
  return recordEditorEvent(
    { ...recording, paused: false },
    { type: 'selection', document: doc, selectedId },
  )
}
// Exporting typed properties is useful for the step editor without exposing arbitrary Layer patches.
export type { ActionProperties }
