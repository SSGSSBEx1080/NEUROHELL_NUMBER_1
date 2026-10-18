import { builtinActions, parseActionSet, type StudioAction } from './actions'
export const ACTION_DRAFT_KEY = 'fsh777-action-recording'
export function loadActionLibrary(): StudioAction[] {
  let actions = builtinActions
  try {
    const data = localStorage.getItem('fsh777-actions')
    if (data) actions = parseActionSet(JSON.parse(data))
  } catch {
    /* defaults remain available */
  }
  try {
    const draft = localStorage.getItem(ACTION_DRAFT_KEY)
    if (draft && actions.length < 100) {
      const recovered = parseActionSet(JSON.parse(draft))[0]
      if (recovered?.steps.length) {
        recovered.source = 'Восстановленная запись 777'
        if (
          !actions.some(
            (a) =>
              a.source === recovered.source &&
              a.name === recovered.name &&
              JSON.stringify(a.steps) === JSON.stringify(recovered.steps),
          )
        )
          actions = [...actions, recovered]
      }
    }
  } catch {
    /* invalid local draft is never executed */
  }
  return actions
}
export function storeActionLibrary(actions: StudioAction[], recording: boolean) {
  const data = JSON.stringify({ version: 2, actions })
  if (new TextEncoder().encode(data).byteLength > 8 * 1024 * 1024)
    throw new Error('Набор операций больше 8 МиБ. Раздели его на несколько экспортируемых наборов.')
  localStorage.setItem('fsh777-actions', data)
  // A recovered/stopped draft is removed only AFTER its library has actually been persisted.
  if (!recording) localStorage.removeItem(ACTION_DRAFT_KEY)
}
