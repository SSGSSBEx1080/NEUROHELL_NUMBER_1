/** Small original binary fixtures. No Adobe artwork or third-party actions are bundled. */
export function atnFixture(): ArrayBuffer {
  const bytes: number[] = []
  const u8 = (v: number) => bytes.push(v & 255)
  const u16 = (v: number) => { u8(v >>> 8); u8(v) }
  const u32 = (v: number) => { u16(v >>> 16); u16(v) }
  const ascii = (s: string) => { for (const c of s) u8(c.charCodeAt(0)) }
  const str = (s: string) => { u32(s.length); ascii(s) }
  const unicode = (s: string) => { u32(s.length + 1); for (const c of s) u16(c.charCodeAt(0)); u16(0) }
  const event = (id: string, name: string) => { u8(1); u8(1); u8(0); u8(0); ascii('long'); ascii(id); str(name); u32(0) }
  const action = (name: string, events: string[]) => { u16(0); u8(0); u8(0); u16(0); unicode(name); u8(1); u32(events.length); for (const id of events) event(id, id === 'Invr' ? 'Invert' : 'Execute script') }
  u32(16); unicode('777 TEST'); u8(1); u32(2)
  action('Безопасный негатив', ['Invr']); action('Заблокированная операция', ['Invr', 'JsCr'])
  return new Uint8Array(bytes).buffer
}
export function psdHeaderFixture(version = 1, width = 300, depth = 8, mode = 3): ArrayBuffer {
  const b = new ArrayBuffer(26), v = new DataView(b)
  v.setUint32(0, 0x38425053); v.setUint16(4, version); v.setUint16(12, 3); v.setUint32(14, 200); v.setUint32(18, width); v.setUint16(22, depth); v.setUint16(24, mode)
  return b
}
