import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchCommands, rememberCommand, readRecentCommands } from '../../src/engine/commandSearch'
afterEach(() => vi.unstubAllGlobals())
const commands = [
  { id: 'curves', label: 'Кривые', group: 'Коррекция' },
  { id: 'levels', label: 'Уровни', group: 'Коррекция', shortcut: 'Ctrl L' },
  { id: 'mask', label: 'Быстрая маска', group: 'Выделение' },
  { id: 'save', label: 'Сохранить PSD…', group: 'Файл' },
  { id: 'locked', label: 'Маска: скрыть всё', group: 'Слой', disabled: true },
]
describe('command discovery without fake actions', () => {
  it.each([
    ['крив', 'curves'],
    ['levels', 'levels'],
    ['rhbdst', 'curves'],
    ['quick mask', 'mask'],
    ['ctrl l', 'levels'],
    ['save', 'save'],
  ])('searches %s → %s', (query, id) => expect(searchCommands(commands, query)[0]?.id).toBe(id))
  it('keeps disabled matching commands visible but ranks available ones first', () => {
    const result = searchCommands(commands, 'маска')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('mask')
    expect(result[1].disabled).toBe(true)
    expect(searchCommands(commands, 'неизвестное')).toHaveLength(0)
  })
  it('remembers bounded IDs and survives rejected storage without breaking search', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key),
      setItem: (key: string, value: string) => store.set(key, value),
    })
    rememberCommand('levels')
    rememberCommand('curves')
    rememberCommand('levels')
    expect(readRecentCommands()).toEqual(['levels', 'curves'])
    expect(searchCommands(commands, '', readRecentCommands())[0].id).toBe('levels')
    store.set('fsh777-command-recents', '[')
    expect(readRecentCommands()).toEqual([])
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('private mode')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => rememberCommand('curves')).not.toThrow()
    expect(searchCommands(commands, 'curves')[0].id).toBe('curves')
  })
})
