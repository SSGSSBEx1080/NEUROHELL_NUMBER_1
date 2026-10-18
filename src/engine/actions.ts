import { DEFAULT_ADJUSTMENTS, type EditorDocument, type Layer } from '../types'
import { isLayerLocked, uid } from './document'
import { deleteLayers, duplicateLayers } from './layerOperations'
import { parseActionCommand, type ActionCommand } from './actionSchema'
export { parseActionCommand, type ActionCommand, type ActionProperties } from './actionSchema'
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
function checkedGeometry(layer: Layer): Layer {
  if (
    ![layer.x, layer.y, layer.width, layer.height, layer.rotation].every(Number.isFinite) ||
    Math.abs(layer.x) > 16384 ||
    Math.abs(layer.y) > 16384 ||
    layer.width < 1 ||
    layer.height < 1 ||
    layer.width > 16384 ||
    layer.height > 16384
  )
    throw new Error('Трансформация операции выходит за допустимые размеры слоя')
  return layer
}
function geometry(layer: Layer, patch: Partial<Layer>): Layer {
  const next = checkedGeometry({ ...layer, ...patch })
  if (layer.mask?.linked) {
    const sx = next.width / layer.width,
      sy = next.height / layer.height
    next.mask = {
      ...layer.mask,
      x: next.x + (layer.mask.x - layer.x) * sx,
      y: next.y + (layer.mask.y - layer.y) * sy,
      width: layer.mask.width * sx,
      height: layer.mask.height * sy,
    }
  }
  return next
}
/** Build an immutable result first. Nothing is committed if ANY enabled step fails. */
export function runAction(
  doc: EditorDocument,
  selectedId: string | null,
  input: StudioAction,
): { document: EditorDocument; selectedId: string | null } {
  const action = parseActionSet({ version: 2, actions: [input] })[0]
  if (actionBlockers(action).length)
    throw new Error('Операция содержит неподдерживаемые шаги и не будет запущена частично')
  if (!action.steps.some((s) => s.enabled)) throw new Error('В операции нет включённых шагов')
  let current = doc,
    id = selectedId
  if (!doc.layers.some((l) => l.id === id)) throw new Error('Выбери слой для операции')
  if (isLayerLocked(doc, id!))
    throw new Error('Разблокируй слой или его группу перед выполнением операции')
  for (const step of action.steps) {
    if (!step.enabled || !step.command) continue
    const c = step.command,
      selected = current.layers.find((l) => l.id === id)
    if (!selected) throw new Error('После удаления активного слоя заверши операцию')
    if (c.type === 'select') {
      const index = current.layers.indexOf(selected) + c.offset,
        target = current.layers[index]
      if (!target) throw new Error('Относительный выбор слоя выходит за границы стека')
      id = target.id
      continue
    }
    if (isLayerLocked(current, selected.id))
      throw new Error(`Шаг «${step.name}»: слой или группа заблокированы`)
    if (c.type === 'duplicate') {
      const result = duplicateLayers(current, selected.id, 0),
        offset = c.offset || { x: 24, y: 24 }
      const oldIds = new Set(current.layers.map((l) => l.id))
      current = {
        ...result.document,
        layers: result.document.layers.map((l) =>
          oldIds.has(l.id)
            ? l
            : checkedGeometry({
                ...l,
                x: l.x + offset.x,
                y: l.y + offset.y,
                mask: l.mask
                  ? { ...l.mask, x: l.mask.x + offset.x, y: l.mask.y + offset.y }
                  : undefined,
              }),
        ),
      }
      id = result.selectedId
      continue
    }
    if (c.type === 'delete') {
      current = deleteLayers(current, selected.id)
      id = null
      continue
    }
    if (selected.kind === 'group')
      throw new Error('Этот шаг рассчитан на обычный слой, не на группу')
    let next: Layer = { ...selected }
    switch (c.type) {
      case 'adjust':
        next.adjustments = { ...selected.adjustments, ...c.values }
        break
      case 'invert':
        next.adjustments = {
          ...selected.adjustments,
          invert: selected.adjustments.invert ? 0 : 100,
        }
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
      case 'transform':
        next = geometry(selected, {
          x: selected.x + c.dx,
          y: selected.y + c.dy,
          width: selected.width * c.scaleX,
          height: selected.height * c.scaleY,
          rotation: (((selected.rotation + c.angle) % 360) + 360) % 360,
        })
        break
      case 'properties': {
        const textKeys = [
          'text',
          'fontFamily',
          'fontSize',
          'fontWeight',
          'italic',
          'textAlign',
          'lineHeight',
          'letterSpacing',
          'textScaleX',
          'textFrame',
        ]
        if (selected.kind !== 'text' && Object.keys(c.values).some((k) => textKeys.includes(k)))
          throw new Error('Шаг типографики требует текстовый слой')
        if (
          selected.kind !== 'shape' &&
          ['radius', 'strokeColor', 'strokeWidth'].some((k) => k in c.values)
        )
          throw new Error('Шаг фигуры требует векторный слой')
        const { styles, textFrame, ...values } = c.values
        next = {
          ...next,
          ...values,
          ...(styles !== undefined ? { styles: styles || undefined } : {}),
          ...(textFrame !== undefined ? { textFrame: textFrame || undefined } : {}),
        }
        break
      }
    }
    current = { ...current, layers: current.layers.map((l) => (l.id === selected.id ? next : l)) }
  }
  return { document: current, selectedId: id }
}
export function parseActionSet(input: unknown): StudioAction[] {
  if (
    !input ||
    typeof input !== 'object' ||
    !('version' in input) ||
    (input.version !== 1 && input.version !== 2) ||
    !('actions' in input) ||
    !Array.isArray(input.actions) ||
    input.actions.length > 100
  )
    throw new Error('Некорректный набор операций .777actions.json')
  return input.actions.map((value: unknown) => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('name' in value) ||
      typeof value.name !== 'string' ||
      !('steps' in value) ||
      !Array.isArray(value.steps) ||
      value.steps.length > 200
    )
      throw new Error('Некорректная операция')
    const a = value as Record<string, unknown>
    const steps: ActionStep[] = value.steps.map((v: unknown) => {
      if (!v || typeof v !== 'object' || !('name' in v) || typeof v.name !== 'string')
        throw new Error('Некорректный шаг операции')
      const s = v as Record<string, unknown>,
        command = parseActionCommand(s.command)
      return {
        name: v.name.slice(0, 100),
        enabled: s.enabled !== false,
        ...(command
          ? { command }
          : {
              unsupported:
                typeof s.unsupported === 'string'
                  ? s.unsupported.slice(0, 300)
                  : 'Команда не поддерживается',
            }),
      }
    })
    const shortcut = a.shortcut as Record<string, unknown> | undefined
    return {
      id: uid(),
      name: value.name.slice(0, 100),
      source: typeof a.source === 'string' ? a.source.slice(0, 100) : 'Импорт 777',
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
