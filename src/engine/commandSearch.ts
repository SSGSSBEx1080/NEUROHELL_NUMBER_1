export interface SearchCommand {
  id: string
  label: string
  group: string
  shortcut?: string
  keywords?: string
  disabled?: boolean
}
const normalize = (s: string) =>
  s
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const latin = "qwertyuiop[]asdfghjkl;'zxcvbnm,.",
  russian = 'йцукенгшщзхъфывапролджэячсмитьбю'
const keyboard = (value: string, from: string, to: string) =>
  [...value]
    .map((c) => {
      const i = from.indexOf(c)
      return i < 0 ? c : to[i]
    })
    .join('')
export const commandAliases: Record<string, string> = {
  Перо: 'pen bezier path',
  'Рисовать пером': 'pen draw bezier path',
  'Узлы контура': 'direct selection nodes anchor',
  'Контур в выделение': 'path to selection',
  'Редактировать узлы': 'edit path nodes bezier anchors',
  Уровни: 'levels',
  Кривые: 'curves',
  Экспозиция: 'exposure',
  'Цветовой тон / насыщенность': 'hue saturation hsl',
  'Цветовой баланс': 'color balance',
  'Микшер каналов': 'channel mixer',
  Постеризация: 'posterize',
  Порог: 'threshold',
  Инверсия: 'invert',
  'Цветовой диапазон…': 'color range selection',
  'Быстрая маска': 'quick mask',
  'Новый корректирующий слой…': 'adjustment layer',
  'Направляющие и сетка…': 'guides grid layout',
  'Выравнивание и интервалы…': 'align distribute spacing',
  'Инвертировать маску': 'invert mask',
  'Сохранить PSD…': 'save photoshop',
  'Открыть файл…': 'open import',
  'Размер холста…': 'canvas size',
  'Размер изображения…': 'image size',
  'Новый проект': 'new document',
  'Волшебная палочка': 'magic wand',
  'Растровые фильтры на копии…': 'filter sharpen noise median high pass mosaic',
}
export function searchCommands<T extends SearchCommand>(
  commands: T[],
  query: string,
  recent: string[] = [],
) {
  const text = query.slice(0, 120).toLocaleLowerCase('ru')
  const variants = [
    ...new Set(
      [text, keyboard(text, latin, russian), keyboard(text, russian, latin)].map(normalize),
    ),
  ]
  const scored = commands
    .map((command, index) => {
      const label = normalize(command.label),
        hay = normalize(
          `${command.label} ${command.group} ${command.shortcut || ''} ${command.keywords || ''} ${commandAliases[command.label] || ''}`,
        )
      let score = -Infinity
      for (const variant of variants) {
        if (!variant) {
          score = recent.includes(command.id) ? 1000 - recent.indexOf(command.id) : 200 - index
          break
        }
        const tokens = variant.split(' ').slice(0, 8)
        if (tokens.every((token) => hay.includes(token)))
          score = Math.max(
            score,
            500 +
              (label === variant ? 200 : label.startsWith(variant) ? 100 : 0) -
              tokens.reduce((n, t) => n + hay.indexOf(t), 0),
          )
      }
      return { command, score: score - (command.disabled ? 100 : 0), index }
    })
    .filter((item) => Number.isFinite(item.score))
    .sort(
      (a, b) =>
        Number(!!a.command.disabled) - Number(!!b.command.disabled) ||
        b.score - a.score ||
        a.index - b.index,
    )
  return scored.map((item) => item.command)
}
export function readRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem('fsh777-command-recents') || '[]'
    if (raw.length > 8192) return []
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v)
      ? v.filter((s): s is string => typeof s === 'string' && s.length <= 200).slice(0, 12)
      : []
  } catch {
    return []
  }
}
export function rememberCommand(id: string) {
  try {
    localStorage.setItem(
      'fsh777-command-recents',
      JSON.stringify([id, ...readRecentCommands().filter((v) => v !== id)].slice(0, 12)),
    )
  } catch {
    /* Search still works if storage is unavailable. */
  }
}
