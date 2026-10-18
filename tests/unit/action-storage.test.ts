import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTION_DRAFT_KEY,
  ACTION_LIBRARY_KEY,
  hasPendingActionDraft,
  loadActionLibrary,
  recoverActionDraft,
  storeActionLibrary,
} from '../../src/engine/actionStorage'
import { parseActionSet } from '../../src/engine/actions'
const data = (name: string) => ({
  name,
  steps: [{ name: 'Invert', enabled: true, command: { type: 'invert' } }],
})
const draft = JSON.stringify({ version: 2, actions: [data('Последняя запись')] })
let values: Map<string, string>, set: ReturnType<typeof vi.fn>
beforeEach(() => {
  values = new Map()
  set = vi.fn((k: string, v: string) => values.set(k, v))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: set,
    removeItem: (k: string) => values.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())
describe('Durable recovery of recorded actions', () => {
  it('retains a draft beside a full library and recovers it only when a slot becomes free', () => {
    const library = parseActionSet({
      version: 2,
      actions: Array.from({ length: 100 }, (_, i) => data('Шаблон ' + i)),
    })
    storeActionLibrary(library, false)
    values.set(ACTION_DRAFT_KEY, draft)
    const full = loadActionLibrary()
    expect(full).toHaveLength(100)
    expect(hasPendingActionDraft(full)).toBe(true)
    storeActionLibrary(full, false)
    expect(values.get(ACTION_DRAFT_KEY)).toBe(draft)
    const recovered = recoverActionDraft(full.slice(1))
    expect(recovered).toHaveLength(100)
    expect(recovered.at(-1)!.source).toBe('Восстановленная запись 777')
    storeActionLibrary(recovered, false)
    expect(values.has(ACTION_DRAFT_KEY)).toBe(false)
    expect(loadActionLibrary()).toHaveLength(100)
  })
  it('never clears the only recovery copy on quota failure or during recording', () => {
    values.set(ACTION_DRAFT_KEY, draft)
    const recovered = loadActionLibrary()
    set.mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => storeActionLibrary(recovered, false)).toThrow('QuotaExceededError')
    expect(values.get(ACTION_DRAFT_KEY)).toBe(draft)
    set.mockImplementation((k: string, v: string) => values.set(k, v))
    storeActionLibrary(recovered, true)
    expect(values.has(ACTION_DRAFT_KEY)).toBe(true)
    storeActionLibrary(recovered, false)
    expect(values.has(ACTION_DRAFT_KEY)).toBe(false)
  })
  it('deduplicates equivalent stopped/recovered drafts, ignores malformed data and never runs code', () => {
    const stopped = parseActionSet(JSON.parse(draft))
    storeActionLibrary(stopped, true)
    values.set(ACTION_DRAFT_KEY, draft)
    expect(loadActionLibrary()).toHaveLength(1)
    expect(hasPendingActionDraft(stopped)).toBe(false)
    storeActionLibrary(stopped, false)
    expect(values.has(ACTION_DRAFT_KEY)).toBe(false)
    values.set(ACTION_DRAFT_KEY, 'not JSON')
    expect(loadActionLibrary()).toHaveLength(1)
    expect(values.get(ACTION_LIBRARY_KEY)).toBeTruthy()
  })
})
