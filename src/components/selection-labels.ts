import type { SelectionMode } from '../types'
import type { SelectionModify } from '../engine/selectionPixels'

// Tiny label maps kept out of the lazily loaded dialog modules so menus stay synchronous.
export const selectionModeNames: Record<SelectionMode, string> = {
  replace: 'Новое выделение',
  add: 'Добавить',
  subtract: 'Вычесть',
  intersect: 'Пересечение',
}

export const selectionModifyNames: Record<SelectionModify, string> = {
  expand: 'Расширить',
  contract: 'Сузить',
  border: 'Граница',
  smooth: 'Сгладить',
  feather: 'Растушевать',
}
