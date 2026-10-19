import { builtinActions, parseActionSet, type StudioAction } from './actions'
export const ACTION_DRAFT_KEY = 'fsh777-action-recording'
export const ACTION_LIBRARY_KEY = 'fsh777-actions'
const MAX_BYTES = 8 * 1024 * 1024
function parseStored(data: string) {
  if (new TextEncoder().encode(data).byteLength > MAX_BYTES) throw new Error('Набор больше 8 МиБ')
  return parseActionSet(JSON.parse(data))
}
function readDraft(): StudioAction | undefined {
  try {
    const data = localStorage.getItem(ACTION_DRAFT_KEY)
    const draft = data ? parseStored(data)[0] : undefined
    return draft?.steps.length ? draft : undefined
  } catch {
    // Invalid data is never executed; leave the bytes intact until an explicit new recording.
    return undefined
  }
}
const containsDraft = (actions: StudioAction[], draft: StudioAction) =>
  actions.some(
    (a) => a.name === draft.name && JSON.stringify(a.steps) === JSON.stringify(draft.steps),
  )
export function hasPendingActionDraft(actions: StudioAction[]) {
  const draft = readDraft()
  return !!draft && !containsDraft(actions, draft)
}
/** A full library must not consume a recovery draft. Retry when the user frees a slot. */
export function recoverActionDraft(actions: StudioAction[]): StudioAction[] {
  const draft = readDraft()
  if (!draft || actions.length >= 100 || containsDraft(actions, draft)) return actions
  return [...actions, { ...draft, source: 'Восстановленная запись 777' }]
}
export function loadActionLibrary(): StudioAction[] {
  let actions = builtinActions
  try {
    const data = localStorage.getItem(ACTION_LIBRARY_KEY)
    if (data) actions = parseStored(data)
  } catch {
    /* defaults remain available */
  }
  return recoverActionDraft(actions)
}
export function storeActionLibrary(actions: StudioAction[], recording: boolean) {
  const data = JSON.stringify({ version: 2, actions })
  if (new TextEncoder().encode(data).byteLength > MAX_BYTES)
    throw new Error('Набор операций больше 8 МиБ. Раздели его на несколько экспортируемых наборов.')
  localStorage.setItem(ACTION_LIBRARY_KEY, data)
  // Remove recovery data only AFTER the exact content is durable in the library, not merely
  // because recording stopped. Full libraries and quota errors must retain the only copy.
  if (!recording) {
    const draft = readDraft()
    if (draft && containsDraft(actions, draft)) localStorage.removeItem(ACTION_DRAFT_KEY)
  }
}
