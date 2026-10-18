import { deflate, Inflate } from 'pako'
/** Namespaced XMP is supplemental editability data. Every file also has ordinary PSD layers and a real merged image. */
const MAX_JSON = 50 * 1024 * 1024
export function encodeProject(project: unknown, originalXmp = '') {
  const text = JSON.stringify(project)
  if (text.length > MAX_JSON)
    throw new Error('Метаданные проекта превышают 50 МБ. Уменьши растровые источники.')
  const bytes = deflate(new TextEncoder().encode(text))
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  const value = `<fsh777:project xmlns:fsh777="https://fsh777.local/project/1/" encoding="deflate-base64">${btoa(binary)}</fsh777:project>`
  const xmp = originalXmp.replace(/<fsh777:project\b[^>]*>[A-Za-z0-9+/=\s]*<\/fsh777:project>/g, '')
  if (xmp.includes('</rdf:RDF>'))
    return xmp.replace(
      '</rdf:RDF>',
      `<rdf:Description rdf:about="">${value}</rdf:Description></rdf:RDF>`,
    )
  return `<?xpacket begin="\uFEFF"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="">${value}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
}
export function decodeProject(xmp?: string): unknown | undefined {
  if (!xmp) return
  const match =
    /<fsh777:project\b[^>]*encoding="deflate-base64"[^>]*>([A-Za-z0-9+/=\s]+)<\/fsh777:project>/.exec(
      xmp,
    )
  if (!match) return
  if (match[1].length > 70 * 1024 * 1024) throw new Error('Слишком большие метаданные PSD')
  const raw = atob(match[1].replace(/\s/g, '')),
    bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
  const inflate = new Inflate({ chunkSize: 65536 })
  const chunks: Uint8Array[] = []
  let size = 0
  inflate.onData = (chunk) => {
    const data = chunk as Uint8Array
    size += data.length
    if (size > MAX_JSON) throw new Error('Метаданные PSD превышают безопасный лимит')
    chunks.push(data)
  }
  inflate.push(bytes, true)
  if (inflate.err) throw new Error('Повреждённые метаданные ФШ777 в PSD')
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(out))
}
