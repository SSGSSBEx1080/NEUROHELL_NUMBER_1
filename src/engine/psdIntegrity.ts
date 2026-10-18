import { xmpResource } from './psdBinary'
const encoder = new TextEncoder()
/** Integrity guard for supplemental XMP, not authentication/signing. If another editor changes
 * the file, stale private project data must NEVER override the real native PSD layers.
 */
function slot(buffer: ArrayBuffer) {
  const section = xmpResource(buffer)
  if (!section) return
  const text = new TextDecoder().decode(new Uint8Array(buffer, section.start, section.length))
  const match = /<fsh777:project\b[^>]*\bsha256="([0-9a-f]{64})"/i.exec(text)
  if (!match) return
  const position = match.index + match[0].lastIndexOf(match[1])
  return { at: section.start + encoder.encode(text.slice(0, position)).length, value: match[1] }
}
async function digestWithEmptySlot(buffer: ArrayBuffer, at: number) {
  const field = new Uint8Array(buffer, at, 64),
    saved = field.slice()
  field.fill(48)
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
    return [...digest].map((n) => n.toString(16).padStart(2, '0')).join('')
  } finally {
    field.set(saved)
  }
}
export async function sealProject(buffer: ArrayBuffer) {
  const found = slot(buffer)
  if (!found) return buffer
  const digest = await digestWithEmptySlot(buffer, found.at)
  new Uint8Array(buffer, found.at, 64).set(encoder.encode(digest))
  return buffer
}
export async function verifyProject(buffer: ArrayBuffer): Promise<'legacy' | 'valid' | 'modified'> {
  const found = slot(buffer)
  if (!found) return 'legacy'
  return (await digestWithEmptySlot(buffer, found.at)) === found.value ? 'valid' : 'modified'
}
