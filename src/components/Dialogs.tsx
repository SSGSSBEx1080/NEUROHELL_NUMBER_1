import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, Check, Download, FileImage, FileJson, Keyboard, LoaderCircle, LockKeyhole, Monitor, RectangleVertical, ShieldCheck, Sparkles, Square, X } from 'lucide-react'
import type { EditorDocument } from '../types'
import { canvasBlob, downloadBlob, exportCanvas } from '../engine/render'
import { Modal, Select, Slider } from './ui'

export function NewDocumentDialog({ onClose, onCreate, onSave }: { onClose: () => void; onCreate: (width: number, height: number, name: string, background: string) => void; onSave: () => void }) {
  const [width, setWidth] = useState('1600'), [height, setHeight] = useState('1000'), [name, setName] = useState('Без названия')
  const [background, setBackground] = useState('#ffffff')
  const valid = Number.isInteger(+width) && Number.isInteger(+height) && +width >= 1 && +height >= 1 && +width <= 4096 && +height <= 4096
  const presets = [{ name: 'Публикация', width: 1080, height: 1080, icon: Square }, { name: 'История', width: 1080, height: 1920, icon: RectangleVertical }, { name: 'Обложка', width: 1600, height: 1000, icon: Monitor }]
  return <Modal title="Начнём с чистого листа" subtitle="Твоя следующая большая идея — прямо здесь." onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); if (valid) onCreate(+width, +height, name.trim() || 'Без названия', background) }}>
      <label className="dialog-label">Название проекта<input autoFocus className="dialog-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Без названия" /></label>
      <div className="document-presets">{presets.map(p => <button type="button" key={p.name} className={+width === p.width && +height === p.height ? 'selected' : ''} onClick={() => { setWidth(String(p.width)); setHeight(String(p.height)) }}><p.icon size={24} strokeWidth={1.4} /><strong>{p.name}</strong><span>{p.width} × {p.height}</span></button>)}</div>
      <div className="dialog-grid"><label className="dialog-label">Ширина, px<input aria-label="Ширина нового холста" className="dialog-input" type="number" value={width} min={1} max={4096} onChange={e => setWidth(e.target.value)} required /></label><span className="dimension-times">×</span><label className="dialog-label">Высота, px<input aria-label="Высота нового холста" className="dialog-input" type="number" value={height} min={1} max={4096} onChange={e => setHeight(e.target.value)} required /></label></div>
      <div className="dialog-label">Фон холста<div className="background-options">{[{ value: '#ffffff', name: 'Светлый' }, { value: '#18181d', name: 'Тёмный' }, { value: 'transparent', name: 'Прозрачный' }].map(bg => <button type="button" key={bg.name} className={background === bg.value ? 'selected' : ''} onClick={() => setBackground(bg.value)}><span className={`bg-swatch ${bg.value === 'transparent' ? 'checkerboard' : ''}`} style={{ backgroundColor: bg.value }}>{background === bg.value && <Check size={12} color={bg.value === '#18181d' ? '#fff' : '#36313e'} />}</span>{bg.name}</button>)}</div></div>
      <div className="info-note"><FileJson size={17} /><span>Новый холст заменит текущий проект.<br /><button type="button" className="text-button" onClick={onSave}>Сохранить текущий проект .777</button></span></div>
      {!valid && <p className="error-text">Размер каждой стороны — от 1 до 4096 пикселей.</p>}
      <footer className="dialog-footer"><span>RGB · 8 бит · sRGB</span><button type="submit" className="primary-button" disabled={!valid}>Создать проект<ArrowUpRight size={16} /></button></footer>
    </form>
  </Modal>
}

export function ExportDialog({ doc, onClose, onSave, onToast }: { doc: EditorDocument; onClose: () => void; onSave: () => void; onToast: (s: string) => void }) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp' | 'psd' | 'psb'>('png')
  const layered = format === 'psd' || format === 'psb'
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(95)
  const [transparent, setTransparent] = useState(doc.background === 'transparent')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    exportCanvas({ ...doc, background: transparent && format !== 'jpeg' ? 'transparent' : doc.background }, Math.min(1, 500 / doc.width, 310 / doc.height), format === 'jpeg' ? '#ffffff' : undefined)
      .then(c => { if (!disposed) setPreview(c.toDataURL()) }).catch(() => { if (!disposed) setError('Не удалось подготовить предпросмотр') })
    return () => { disposed = true }
  }, [doc, transparent, format])
  const runExport = async () => {
    setBusy(true); setError('')
    try {
      if (layered) {
        const { exportPsd } = await import('../engine/psd')
        const blob = await exportPsd(doc, format === 'psb')
        downloadBlob(blob, `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`)
        onToast(`${format.toUpperCase()} со слоями готов к скачиванию`); onClose(); return
      }
      const output = await exportCanvas({ ...doc, background: transparent && format !== 'jpeg' ? 'transparent' : doc.background }, scale, format === 'jpeg' ? '#ffffff' : undefined)
      const blob = await canvasBlob(output, `image/${format}`, quality / 100)
      downloadBlob(blob, `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.${format === 'jpeg' ? 'jpg' : format}`)
      onToast(`Готово! ${format.toUpperCase()} · ${Math.round(doc.width * scale)} × ${Math.round(doc.height * scale)} · ${(blob.size / 1024 / 1024).toFixed(2)} МБ`)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка экспорта') }
    finally { setBusy(false) }
  }
  return <Modal title="Пора показать миру" subtitle="Твоя работа. В лучшем качестве. Без водяных знаков." onClose={busy ? () => {} : onClose}>
    <div className="export-preview checkerboard">{preview ? <img src={preview} alt="Предпросмотр экспортируемого изображения" /> : <LoaderCircle className="spin" size={24} />}</div>
    <div className="export-file-info"><FileImage size={16} /><span>{doc.name}</span><span>{Math.round(doc.width * scale)} × {Math.round(doc.height * scale)} px</span></div>
    <div className="format-options">{(['png', 'jpeg', 'webp', 'psd', 'psb'] as const).map(f => <button key={f} className={format === f ? 'selected' : ''} onClick={() => { setFormat(f); if (f === 'psd' || f === 'psb') setScale(1) }}><strong>{f === 'jpeg' ? 'JPG' : f.toUpperCase()}</strong><span>{f === 'png' ? 'Без потерь' : f === 'jpeg' ? 'Для фото' : f === 'psd' || f === 'psb' ? 'Со слоями' : 'Для веба'}</span>{format === f && <Check size={14} />}</button>)}</div>
    <div className="export-options" style={layered ? { display: 'none' } : undefined}><label className="dialog-label">Масштаб<Select aria-label="Масштаб экспорта" value={scale} onChange={e => setScale(+e.target.value)}><option value={0.5}>0.5× — уменьшенный</option><option value={1}>1× — оригинальный</option><option value={2} disabled={doc.width * doc.height * 4 > 32_000_000}>2× — увеличенный</option></Select></label><label className={`checkbox-row ${format === 'jpeg' ? 'muted' : ''}`}><input type="checkbox" checked={transparent && format !== 'jpeg'} disabled={format === 'jpeg'} onChange={e => setTransparent(e.target.checked)} />Прозрачный холст</label></div>
    {!layered && format !== 'png' && <Slider label="Качество" value={quality} min={10} max={100} suffix="%" onChange={setQuality} />}
    {layered && <div className="info-note"><FileJson size={16} /><span>RGB / 8 бит. Слои, видимость и наложение сохраняются. Эффекты и фигуры растрируются; простой текст записывается с текстовыми данными (может потребоваться замена шрифта). Пиксели за холстом обрезаются. Для полной редактируемости сохрани также .777.</span></div>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <footer className="dialog-footer"><button className="text-button" onClick={onSave}><FileJson size={14} />Сохранить проект .777</button><button className="primary-button" onClick={runExport} disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}{busy ? 'Экспортируем…' : `Скачать ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}`}</button></footer>
  </Modal>
}

const shortcuts = [
  ['Перемещение', 'V'], ['Выделение', 'M'], ['Кадрирование', 'C'], ['Кисть / ластик', 'B / E'], ['Волшебный ластик', 'W'], ['Текст', 'T'], ['Прямоугольник / эллипс', 'U / O'], ['Пипетка', 'I'], ['Рука', 'H / Пробел'], ['Отменить', 'Ctrl Z'], ['Повторить', 'Ctrl Shift Z'], ['Дублировать слой', 'Ctrl J'], ['Копировать / вставить слой', 'Ctrl C / V'], ['Новый пустой слой', 'Ctrl Shift N'], ['Объединить видимые', 'Ctrl Shift E'], ['Инверсия', 'Ctrl I'], ['Обесцветить', 'Ctrl Shift U'], ['Показать трансформацию', 'Ctrl T'], ['Удалить слой', 'Delete'], ['Открыть файл', 'Ctrl O'], ['Сохранить проект', 'Ctrl S'], ['Экспортировать', 'Ctrl Shift S'], ['По размеру окна', 'Ctrl 0'], ['Масштаб 100%', 'Ctrl 1'], ['Снять выделение', 'Esc'], ['Двигать слой', '← ↑ ↓ →'], ['Шаг 10 пикселей', 'Shift + стрелка'], ['Размер кисти', '[ / ]'],
]
export function HelpDialog({ onClose, initialTab = 'shortcuts' }: { onClose: () => void; initialTab?: 'shortcuts' | 'about' }) {
  const [tab, setTab] = useState(initialTab)
  return <Modal title="Твоя студия. Твои правила." subtitle="ФШ 777 / независимый графический редактор" onClose={onClose} wide>
    <div className="help-tabs"><button className={tab === 'shortcuts' ? 'selected' : ''} onClick={() => setTab('shortcuts')}><Keyboard size={15} />Горячие клавиши</button><button className={tab === 'about' ? 'selected' : ''} onClick={() => setTab('about')}><Sparkles size={15} />О редакторе</button></div>
    {tab === 'shortcuts' ? <><div className="shortcut-grid">{shortcuts.map(([name, key]) => <div key={name}><span>{name}</span><kbd>{key}</kbd></div>)}</div><p className="help-footnote">На macOS используй ⌘ вместо Ctrl. Двойной клик по тексту — редактирование. Shift сохраняет пропорции фигур и ограничивает перемещение. Файлы можно перетаскивать и вставлять из буфера обмена.</p></> : <div className="about-content">
      <div className="about-hero"><div className="about-777">777</div><div><span className="eyebrow">МЕНЬШЕ ЛИШНЕГО. БОЛЬШЕ ТВОЕГО.</span><h3>Идеи не должны<br />ждать загрузки.</h3></div></div>
      <div className="about-feature"><LockKeyhole size={20} /><div><strong>Твои файлы остаются у тебя</strong><p>Редактирование происходит в браузере. Изображения не загружаются на сервер. Последний проект автоматически сохраняется в IndexedDB на этом устройстве. Для надёжного хранения скачай файл .777.</p></div></div>
      <div className="about-feature"><Sparkles size={20} /><div><strong>Честно о возможностях</strong><p>Это первая версия: слои, трансформации, текст, кисти, фигуры, цветокоррекция и экспорт. Удаление фона использует цвета краёв, а заливка окружением — диффузию; это не нейросетевые инструменты. Сложные волосы, фактуры и большие объекты потребуют ручной доработки.</p></div></div>
      <div className="about-feature"><ShieldCheck size={20} /><div><strong>Независимый редактор</strong><p>Собственные интерфейс, код и формат проекта. Не связан с Adobe. PSD/PSB поддерживаются частично: RGB / 8 бит, до 4096 × 4096. Импорт показывает отчёт о преобразованиях. RAW, CMYK, плагины и редактирование смарт-объектов не поддерживаются. Шрифты Manrope и Unbounded распространяются по SIL OFL, зависимости — по разрешительным лицензиям.</p></div></div>
      <p className="help-footnote">Версия 0.2.0 · Холст до 4096 × 4096 px · До 100 слоёв · История 30 действий<br />Независимая реализация снижает риски копирования, но не является юридической гарантией.</p>
    </div>}
    <footer className="dialog-footer"><span>Создавай то, чего ещё нет.</span><button className="primary-button" onClick={onClose}>Вернуться к идеям<ArrowUpRight size={15} /></button></footer>
  </Modal>
}

export function ReplaceDialog({ name, onSave, onConfirm, onClose }: { name: string; onSave: () => void; onConfirm: () => void; onClose: () => void }) {
  return <Modal title="Открыть другой проект?" subtitle={`«${name}» заменит текущий холст и историю действий.`} onClose={onClose}><div className="info-note"><ArrowDownToLine size={20} /><span>Чтобы не потерять работу, сначала сохрани текущий проект. Автосохранение хранит только последний открытый холст.</span></div><button className="secondary-button save-before-replace" onClick={onSave}><FileJson size={16} />Сохранить текущий .777</button><footer className="dialog-footer"><button className="secondary-button" onClick={onClose}><X size={15} />Остаться</button><button className="primary-button" onClick={onConfirm}>Открыть проект<ArrowUpRight size={15} /></button></footer></Modal>
}
