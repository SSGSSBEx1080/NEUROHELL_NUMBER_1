import type { EditorDocument } from '../types'
import { renderDocument } from './render'
/** One pending frame, latest state wins; never draw twice for a single pointer update. */
export class FrameScheduler {
  private frame = 0
  request(draw: () => void) { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { this.frame = 0; draw() }) }
  cancel() { cancelAnimationFrame(this.frame); this.frame = 0 }
}
/** Cached unchanged bottom stack. Blend modes stay correct because only a prefix is flattened. */
export class SceneRenderer {
  private prefix?: { layers: EditorDocument['layers']; background: string; width: number; height: number; canvas: HTMLCanvasElement }
  draw(ctx: CanvasRenderingContext2D, doc: EditorDocument, overrides: Map<string, HTMLCanvasElement>, activeId?: string) {
    const index = doc.layers.findIndex(l => l.id === activeId)
    if (index <= 0 || doc.sourceId || doc.layers.some(l => l.parentId || l.kind === 'group' || l.clipping)) { renderDocument(ctx, doc, overrides); return }
    const layers = doc.layers.slice(0, index), width = ctx.canvas.width, height = ctx.canvas.height, p = this.prefix
    if (!p || p.width !== width || p.height !== height || p.background !== doc.background || p.layers.length !== layers.length || p.layers.some((l, i) => l !== layers[i])) {
      const c = document.createElement('canvas'); c.width = width; c.height = height
      const x = c.getContext('2d')!; x.scale(width / doc.width, height / doc.height)
      renderDocument(x, { ...doc, layers }, overrides)
      this.prefix = { layers, background: doc.background, width, height, canvas: c }
    }
    ctx.clearRect(0, 0, doc.width, doc.height); ctx.drawImage(this.prefix!.canvas, 0, 0, doc.width, doc.height)
    renderDocument(ctx, { ...doc, background: 'transparent', layers: doc.layers.slice(index) }, overrides, undefined, false)
  }
  clear() { this.prefix = undefined }
}
