export type DockTab = 'properties' | 'texts' | 'actions'
export interface PanelLayout {
  preset: 'standard' | 'texts' | 'properties' | 'custom'
  side: 'left' | 'right'
  tab: DockTab
  width: number
  split: number
  floating: boolean
  x: number
  y: number
  height: number
}
export const defaultPanelLayout: PanelLayout = {
  preset: 'standard',
  side: 'right',
  tab: 'properties',
  width: 300,
  split: 0.54,
  floating: false,
  x: 900,
  y: 110,
  height: 650,
}
export function panelPreset(preset: PanelLayout['preset']): PanelLayout {
  return {
    ...defaultPanelLayout,
    preset,
    ...(preset === 'texts'
      ? { width: 360, split: 0.66, tab: 'texts' as const }
      : preset === 'properties'
        ? { width: 340, split: 0.74 }
        : {}),
  }
}
export function normalizePanelLayout(input: unknown): PanelLayout {
  const p = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  // Persisted preferences from earlier versions remain readable; these labels are not UI options.
  const aliases: Record<string, PanelLayout['preset']> = {
    retouch: 'standard',
    layout: 'texts',
    manga: 'texts',
    type: 'properties',
  }
  const migrated =
    typeof p.preset === 'string' && Object.hasOwn(aliases, p.preset) ? aliases[p.preset] : p.preset
  const number = (key: keyof PanelLayout, min: number, max: number) =>
    typeof p[key] === 'number' && Number.isFinite(p[key])
      ? Math.min(max, Math.max(min, p[key] as number))
      : (defaultPanelLayout[key] as number)
  return {
    preset: ['standard', 'texts', 'properties', 'custom'].includes(String(migrated))
      ? (migrated as PanelLayout['preset'])
      : 'standard',
    side: p.side === 'left' ? 'left' : 'right',
    tab:
      p.tab === 'texts' || p.tab === 'translation'
        ? 'texts'
        : p.tab === 'actions'
          ? 'actions'
          : 'properties',
    width: number('width', 240, 520),
    split: number('split', 0.25, 0.8),
    floating: p.floating === true,
    x: number('x', 0, 12000),
    y: number('y', 0, 12000),
    height: number('height', 360, 1600),
  }
}
/** Display bounds clamp old monitor coordinates without destroying the stored layout. */
export function visiblePanelLayout(
  layout: PanelLayout,
  viewport: { width: number; height: number },
): PanelLayout {
  const width = Math.min(layout.width, Math.max(240, viewport.width - (layout.floating ? 20 : 420)))
  const height = Math.min(layout.height, Math.max(300, viewport.height - 20))
  return {
    ...layout,
    width,
    height,
    x: Math.min(Math.max(0, layout.x), Math.max(0, viewport.width - width - 5)),
    y: Math.min(Math.max(0, layout.y), Math.max(0, viewport.height - height - 5)),
  }
}
export function loadPanelLayout() {
  try {
    return normalizePanelLayout(JSON.parse(localStorage.getItem('fsh777-panels') || '{}'))
  } catch {
    return { ...defaultPanelLayout }
  }
}
export function savePanelLayout(layout: PanelLayout) {
  try {
    localStorage.setItem('fsh777-panels', JSON.stringify(normalizePanelLayout(layout)))
  } catch {
    /* Panel controls remain usable without storage. */
  }
}
