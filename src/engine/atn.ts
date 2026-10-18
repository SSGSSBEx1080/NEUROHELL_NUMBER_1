import type { ActionCommand, ActionStep, StudioAction } from './actions'
import { uid } from './document'
/** A bounded, data-only reader for the public ATN v16 binary layout. No JSX, scripts, plugins or external paths execute. */
type Value = string | number | boolean | Value[] | { [key: string]: Value }
class Reader {
  offset = 0
  nodes = 0
  view: DataView
  constructor(readonly buffer: ArrayBuffer) { this.view = new DataView(buffer) }
  take(size: number) { if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.buffer.byteLength) throw new Error('ATN: обрезанный или некорректный файл'); const start = this.offset; this.offset += size; return start }
  u8() { return this.view.getUint8(this.take(1)) }
  u16() { return this.view.getUint16(this.take(2)) }
  u32() { return this.view.getUint32(this.take(4)) }
  i32() { return this.view.getInt32(this.take(4)) }
  float() { const value = this.view.getFloat64(this.take(8)); if (!Number.isFinite(value)) throw new Error('ATN: некорректное число'); return value }
  count(max = 1000) { const n = this.u32(); if (n > max) throw new Error('ATN: превышен лимит элементов'); return n }
  ascii(size = this.count(65536)) { return new TextDecoder('utf-8').decode(new Uint8Array(this.buffer, this.take(size), size)).replace(/\0+$/, '') }
  unicode() { const length = this.count(32768); return new TextDecoder('utf-16be').decode(new Uint8Array(this.buffer, this.take(length * 2), length * 2)).replace(/\0+$/, '') }
  id() { const n = this.count(4096); return this.ascii(n || 4).trim() }
  descriptor(depth: number): { [key: string]: Value } {
    if (depth > 24 || ++this.nodes > 20000) throw new Error('ATN: слишком сложный дескриптор')
    this.unicode(); const classId = this.id(), count = this.count()
    const result: { [key: string]: Value } = Object.create(null); result._class = classId
    for (let i = 0; i < count; i++) { const key = this.id(); result[key] = this.value(this.ascii(4), depth + 1) }
    return result
  }
  value(type: string, depth: number): Value {
    if (depth > 24 || ++this.nodes > 20000) throw new Error('ATN: превышена сложность данных')
    switch (type) {
      case 'Objc': case 'GlbO': return this.descriptor(depth + 1)
      case 'TEXT': return this.unicode()
      case 'long': return this.i32()
      case 'doub': return this.float()
      case 'bool': return !!this.u8()
      case 'enum': return { enum: this.id(), value: this.id() }
      case 'UntF': return { unit: this.ascii(4), value: this.float() }
      case 'UnFl': { const unit = this.ascii(4), count = this.count(); return { unit, values: Array.from({ length: count }, () => this.float()) } }
      case 'VlLs': return Array.from({ length: this.count() }, () => this.value(this.ascii(4), depth + 1))
      case 'type': case 'GlbC': return { name: this.unicode(), class: this.id() }
      case 'alis': case 'tdta': case 'Pth ': { const length = this.count(4 * 1024 * 1024); this.take(length); return { binaryBytes: length } }
      case 'comp': { this.take(8); return { unsupported: '64-bit integer' } }
      case 'obj ': {
        return Array.from({ length: this.count(100) }, (): Value => {
          const form = this.ascii(4)
          if (form === 'Idnt' || form === 'indx') return { form, index: this.i32() }
          const name = this.unicode(), classId = this.id()
          if (form === 'prop') return { form, name, classId, key: this.id() }
          if (form === 'Clss') return { form, name, classId }
          if (form === 'Enmr') return { form, name, classId, enum: this.id(), value: this.id() }
          if (form === 'rele') return { form, name, classId, offset: this.i32() }
          if (form === 'name') return { form, name, classId, value: this.unicode() }
          throw new Error(`ATN: неизвестный тип ссылки ${form}`)
        })
      }
      default: throw new Error(`ATN: тип данных ${type.trim()} пока не поддерживается. Набор не изменён.`)
    }
  }
}
function translate(event: string, descriptor: Record<string, Value>): { command?: ActionCommand; unsupported?: string } {
  const keys = Object.keys(descriptor).filter(k => k !== '_class')
  const empty = keys.length === 0
  if ((event === 'Dstt' || event === 'desaturate') && empty) return { command: { type: 'adjust', values: { saturation: -100 } } }
  if ((event === 'Invr' || event === 'invert') && empty) return { command: { type: 'invert' } }
  if ((event === 'Dplc' || event === 'duplicate') && empty) return { command: { type: 'duplicate' } }
  if ((event === 'GsnB' || event === 'gaussianBlur') && keys.length === 1 && (keys[0] === 'Rds' || keys[0] === 'radius')) {
    const r = descriptor[keys[0]]
    if (r && typeof r === 'object' && !Array.isArray(r) && r.unit === '#Pxl' && typeof r.value === 'number' && r.value >= 0 && r.value <= 30) return { command: { type: 'adjust', values: { blur: r.value } } }
  }
  if ((event === 'BrgC' || event === 'brightnessEvent') && keys.every(k => ['Brgh', 'Cntr', 'useLegacy'].includes(k)) && typeof descriptor.Brgh === 'number' && typeof descriptor.Cntr === 'number' && Math.abs(descriptor.Brgh) <= 100 && Math.abs(descriptor.Cntr) <= 100) return { command: { type: 'adjust', values: { brightness: descriptor.Brgh, contrast: descriptor.Cntr } } }
  return { unsupported: `${event}: команда или её адресация/параметры не поддерживаются` }
}
export function parseAtn(buffer: ArrayBuffer): StudioAction[] {
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('ATN: файл до 8 МБ')
  const r = new Reader(buffer)
  if (r.u32() !== 16) throw new Error('Поддерживается только формат операций ATN v16')
  const setName = r.unicode(); r.u8()
  const count = r.count(100), actions: StudioAction[] = []
  for (let i = 0; i < count; i++) {
    const functionKey = r.u16(), shift = !!r.u8(), ctrl = !!r.u8(); r.u16()
    const name = r.unicode(); r.u8(); const stepCount = r.count(200), steps: ActionStep[] = []
    for (let n = 0; n < stepCount; n++) {
      r.u8(); const enabled = !!r.u8(), dialog = !!r.u8(); r.u8()
      const kind = r.ascii(4)
      if (kind !== 'TEXT' && kind !== 'long') throw new Error('ATN: некорректный идентификатор события')
      const event = (kind === 'TEXT' ? r.ascii() : r.ascii(4)).trim(), display = r.ascii()
      const hasDescriptor = r.i32()
      if (![0, -1, 1].includes(hasDescriptor)) throw new Error('ATN: неизвестная версия дескриптора')
      const descriptor = hasDescriptor ? r.descriptor(0) : {}
      const translated = dialog ? { unsupported: 'Шаг запрашивает диалог Photoshop: автоматическое исполнение заблокировано' } : translate(event, descriptor)
      steps.push({ name: display || event, enabled, ...translated })
    }
    actions.push({ id: uid(), name: name || `Операция ${i + 1}`, source: `ATN · ${setName}`, steps, shortcut: functionKey >= 1 && functionKey <= 12 ? { key: `F${functionKey}`, shift, ctrl } : undefined })
  }
  if (r.offset !== buffer.byteLength) throw new Error('ATN: дополнительные данные неизвестного формата. Импорт отменён целиком.')
  return actions
}
