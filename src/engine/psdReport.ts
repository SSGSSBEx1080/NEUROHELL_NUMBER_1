import type { Psd, Layer as PsdLayer } from 'ag-psd'
export interface PsdExportReport {
  original: boolean
  text: number
  shapes: number
  smart: number
  groups: number
  guides: number
  adjustments: number
  images: number
  masks: number
  vectorMasks: number
  clipping: number
  editableContents: number
  fonts: string[]
  warnings: string[]
}
export function inspectNativeLayers(
  psd: Psd,
  warnings: string[],
  editableContents = 0,
): PsdExportReport {
  const report: PsdExportReport = {
    original: false,
    text: 0,
    shapes: 0,
    smart: 0,
    groups: 0,
    guides: psd.imageResources?.gridAndGuidesInformation?.guides?.length || 0,
    adjustments: 0,
    images: 0,
    masks: 0,
    vectorMasks: 0,
    clipping: 0,
    editableContents,
    fonts: [],
    warnings: [...new Set(warnings)],
  }
  const visit = (layers: PsdLayer[]) => {
    for (const l of layers) {
      if (l.children) {
        report.groups++
        visit(l.children)
      } else if (l.text) {
        report.text++
        if (l.text.style?.font?.name) report.fonts.push(l.text.style.font.name)
      } else if (l.placedLayer) report.smart++
      else if (l.vectorFill && l.vectorMask) report.shapes++
      else if (l.adjustment) report.adjustments++
      else report.images++
      if (l.mask) report.masks++
      if (l.vectorMask) report.vectorMasks++
      if (l.clipping) report.clipping++
    }
  }
  visit(psd.children || [])
  report.fonts = [...new Set(report.fonts)]
  return report
}
