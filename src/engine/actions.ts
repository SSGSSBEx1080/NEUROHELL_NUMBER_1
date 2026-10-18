import { DEFAULT_ADJUSTMENTS, type Adjustments, type EditorDocument, type Layer } from '../types'
import { uid } from './document'
export type ActionCommand =
  | { type: 'adjust'; values: Partial<Adjustments> }
  | { type: 'invert' | 'duplicate' | 'flipX' | 'flipY' | 'reset' }
  | { type: 'rotate'; angle: number }
export interface ActionStep {
  name: string
  enabled: boolean
  command?: ActionCommand
  unsupported?: string
}
export interface StudioAction {
  id: string
  name: string
  source: string
  steps: ActionStep[]
  shortcut?: { key: string; shift: boolean; ctrl: boolean }
}
const commandStep = (name: string, command: ActionCommand): ActionStep => ({
  name,
  command,
  enabled: true,
})
export const builtinActions: StudioAction[] = [
  {
    id: 'mono',
    name: 'Матовый монохром',
    source: '777 STUDIO',
    shortcut: { key: 'F2', shift: true, ctrl: false },
    steps: [
      commandStep('Обесцветить', { type: 'adjust', values: { grayscale: 100 } }),
      commandStep('Мягкий контраст', { type: 'adjust', values: { contrast: -15, brightness: 8 } }),
    ],
  },
  {
    id: 'cinema',
    name: 'Кинематографичный',
    source: '777 STUDIO',
    shortcut: { key: 'F3', shift: true, ctrl: false },
    steps: [
      commandStep('Насыщенность −25', { type: 'adjust', values: { saturation: -25 } }),
      commandStep('Глубина и свет', { type: 'adjust', values: { contrast: 25, brightness: -5 } }),
    ],
  },
  {
    id: 'warm',
    name: 'Тёплая плёнка',
    source: '777 STUDIO',
    shortcut: { key: 'F4', shift: true, ctrl: false },
    steps: [
      commandStep('Сепия и цвет', { type: 'adjust', values: { sepia: 30, saturation: 10 } }),
      commandStep('Мягкое свечение', { type: 'adjust', values: { contrast: -8, brightness: 8 } }),
    ],
  },
  {
    id: 'dream',
    name: 'Мягкий фокус',
    source: '777 STUDIO',
    steps: [
      commandStep('Размытие', { type: 'adjust', values: { blur: 2 } }),
      commandStep('Воздух', { type: 'adjust', values: { brightness: 12, saturation: -12 } }),
    ],
  },
  {
    id: 'negative',
    name: 'Другой полюс',
    source: '777 STUDIO',
    steps: [commandStep('Инверсия цвета', { type: 'invert' })],
  },
  {
    id: 'mirror',
    name: 'Зеркальная копия',
    source: '777 STUDIO',
    steps: [
      commandStep('Копия слоя', { type: 'duplicate' }),
      commandStep('Отражение по горизонтали', { type: 'flipX' }),
    ],
  },
]
export function actionBlockers(action: StudioAction) {
  return action.steps.filter((s) => s.enabled && !s.command)
}
export function runAction(
  doc: EditorDocument,
  selectedId: string | null,
  action: StudioAction,
): { document: EditorDocument; selectedId: string } {
  if (actionBlockers(action).length)
    throw new Error('Операция содержит неподдерживаемые шаги и не будет запущена частично')
  if (!action.steps.some((s) => s.enabled)) throw new Error('В операции нет включённых шагов')
  const original = doc.layers.find((l) => l.id === selectedId)
  if (!original) throw new Error('Выбери слой для операции')
  if (original.locked) throw new Error('Разблокируй слой перед выполнением операции')
  let selected: Layer = original
  const layers = [...doc.layers]
  for (const step of action.steps) {
    if (!step.enabled || !step.command) continue
    const c = step.command
    let next: Layer = { ...selected, adjustments: { ...selected.adjustments } }
    switch (c.type) {
      case 'adjust':
        next.adjustments = { ...next.adjustments, ...c.values }
        break
      case 'invert':
        next.adjustments.invert = next.adjustments.invert ? 0 : 100
        break
      case 'reset':
        next.adjustments = { ...DEFAULT_ADJUSTMENTS }
        break
      case 'flipX':
        next.flipX = !next.flipX
        break
      case 'flipY':
        next.flipY = !next.flipY
        break
      case 'rotate':
        next.rotation = (next.rotation + c.angle + 360) % 360
        break
      case 'duplicate':
        if (layers.length >= 100) throw new Error('В документе не может быть больше 100 слоёв')
        next = { ...next, id: uid(), name: `${next.name} — копия`, x: next.x + 24, y: next.y + 24 }
        layers.splice(layers.findIndex((l) => l.id === selected!.id) + 1, 0, next)
        selected = next
        continue
    }
    layers[layers.findIndex((l) => l.id === selected!.id)] = next
    selected = next
  }
  return { document: { ...doc, layers }, selectedId: selected.id }
}
const limits: Record<keyof Adjustments, [number, number]> = {
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  blur: [0, 30],
  hue: [-180, 180],
  grayscale: [0, 100],
  sepia: [0, 100],
  invert: [0, 100],
}
export function parseActionSet(input: unknown): StudioAction[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !('version' in input) ||
    input.version !== 1 ||
    !('actions' in input) ||
    !Array.isArray(input.actions) ||
    input.actions.length > 100
  )
    throw new Error('Некорректный набор операций .777actions.json')
  return input.actions.map((a: unknown) => {
    if (
      !a ||
      typeof a !== 'object' ||
      !('name' in a) ||
      typeof a.name !== 'string' ||
      !('steps' in a) ||
      !Array.isArray(a.steps) ||
      a.steps.length > 200
    )
      throw new Error('Некорректная операция')
    const steps: ActionStep[] = a.steps.map((s: unknown) => {
      if (!s || typeof s !== 'object' || !('name' in s) || typeof s.name !== 'string')
        throw new Error('Некорректный шаг операции')
      const step: ActionStep = {
        name: s.name.slice(0, 100),
        enabled: !('enabled' in s) || s.enabled !== false,
      }
      if (
        !('command' in s) ||
        !s.command ||
        typeof s.command !== 'object' ||
        !('type' in s.command)
      )
        return { ...step, unsupported: 'Команда не поддерживается' }
      const c = s.command as Record<string, unknown>
      if (c.type === 'adjust' && c.values && typeof c.values === 'object') {
        const values: Partial<Adjustments> = {}
        for (const [key, value] of Object.entries(c.values)) {
          if (!Object.hasOwn(limits, key) || typeof value !== 'number' || !Number.isFinite(value))
            throw new Error('Некорректная цветокоррекция в операции')
          const [min, max] = limits[key as keyof Adjustments]
          values[key as keyof Adjustments] = Math.max(min, Math.min(max, value))
        }
        step.command = { type: 'adjust', values }
      } else if (c.type === 'rotate' && typeof c.angle === 'number' && Number.isFinite(c.angle))
        step.command = { type: 'rotate', angle: c.angle % 360 }
      else if (['invert', 'duplicate', 'flipX', 'flipY', 'reset'].includes(String(c.type)))
        step.command = { type: c.type as 'invert' }
      else step.unsupported = `Неподдерживаемая команда: ${String(c.type).slice(0, 50)}`
      return step
    })
    const raw = a as Record<string, unknown>,
      shortcut = raw.shortcut as Record<string, unknown> | undefined
    return {
      id: uid(),
      name: a.name.slice(0, 100),
      source: typeof raw.source === 'string' ? raw.source.slice(0, 100) : 'Импорт 777',
      steps,
      ...(shortcut && typeof shortcut.key === 'string' && /^F([1-9]|1[0-2])$/.test(shortcut.key)
        ? {
            shortcut: {
              key: shortcut.key,
              ctrl: shortcut.ctrl === true,
              shift: shortcut.shift === true,
            },
          }
        : {}),
    }
  })
}
