export interface TextDecorationMetrics {
  /** Thickness of both decoration rules in layer pixels. */
  thickness: number
  /** Top edge of the underline relative to the alphabetic baseline. */
  underlineTopOffset: number
  /** Top edge of the strikethrough relative to the alphabetic baseline. */
  strikethroughTopOffset: number
}

/**
 * ФШ777's own decoration geometry. Canvas2D does not expose font underline
 * metrics, so these stable em-based offsets define the local model; PSD
 * stores only the boolean flags and another editor may use its font metrics.
 */
export function textDecorationMetrics(fontSize: number): TextDecorationMetrics {
  const size = Number.isFinite(fontSize) ? Math.max(0, Math.min(1000, fontSize)) : 48
  return {
    thickness: Math.max(1, size * 0.055),
    underlineTopOffset: size * 0.1,
    strikethroughTopOffset: -size * 0.34,
  }
}
