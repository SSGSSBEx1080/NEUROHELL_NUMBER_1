import { version as appVersion } from '../../package.json'
import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Download,
  FileImage,
  FileJson,
  Keyboard,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  RectangleVertical,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import type { EditorDocument } from '../types'
import { canvasBlob, downloadBlob, exportCanvas } from '../engine/render'
import {
  WORKING_RGB_PROFILE,
  buildIccProfile,
  builtinColorProfiles,
  createColorTransform,
  documentColorProfileLabel,
  profilesMatch,
} from '../engine/colorProfiles'
import { embedJpegIccProfile, embedPngIccProfile } from '../engine/imageIcc'
import { BrandMark } from './Brand'
import { Modal, Select, Slider } from './ui'

export function NewDocumentDialog({
  onClose,
  onCreate,
  onSave,
}: {
  onClose: () => void
  onCreate: (width: number, height: number, name: string, background: string) => void
  onSave: () => void
}) {
  const [width, setWidth] = useState('1600'),
    [height, setHeight] = useState('1000'),
    [name, setName] = useState('Без названия')
  const [background, setBackground] = useState('#ffffff')
  const valid =
    Number.isInteger(+width) &&
    Number.isInteger(+height) &&
    +width >= 1 &&
    +height >= 1 &&
    +width <= 4096 &&
    +height <= 4096
  const presets = [
    { name: 'Публикация', width: 1080, height: 1080, icon: Square },
    { name: 'История', width: 1080, height: 1920, icon: RectangleVertical },
    { name: 'Обложка', width: 1600, height: 1000, icon: Monitor },
  ]
  return (
    <Modal
      title="Начнём с чистого листа"
      subtitle="Твоя следующая большая идея — прямо здесь."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onCreate(+width, +height, name.trim() || 'Без названия', background)
        }}
      >
        <label className="dialog-label">
          Название проекта
          <input
            autoFocus
            className="dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Без названия"
          />
        </label>
        <div className="document-presets">
          {presets.map((p) => (
            <button
              type="button"
              key={p.name}
              className={+width === p.width && +height === p.height ? 'selected' : ''}
              onClick={() => {
                setWidth(String(p.width))
                setHeight(String(p.height))
              }}
            >
              <p.icon size={24} strokeWidth={1.4} />
              <strong>{p.name}</strong>
              <span>
                {p.width} × {p.height}
              </span>
            </button>
          ))}
        </div>
        <div className="dialog-grid">
          <label className="dialog-label">
            Ширина, px
            <input
              aria-label="Ширина нового холста"
              className="dialog-input"
              type="number"
              value={width}
              min={1}
              max={4096}
              onChange={(e) => setWidth(e.target.value)}
              required
            />
          </label>
          <span className="dimension-times">×</span>
          <label className="dialog-label">
            Высота, px
            <input
              aria-label="Высота нового холста"
              className="dialog-input"
              type="number"
              value={height}
              min={1}
              max={4096}
              onChange={(e) => setHeight(e.target.value)}
              required
            />
          </label>
        </div>
        <div className="dialog-label">
          Фон холста
          <div className="background-options">
            {[
              { value: '#ffffff', name: 'Светлый' },
              { value: '#18181d', name: 'Тёмный' },
              { value: 'transparent', name: 'Прозрачный' },
            ].map((bg) => (
              <button
                type="button"
                key={bg.name}
                className={background === bg.value ? 'selected' : ''}
                onClick={() => setBackground(bg.value)}
              >
                <span
                  className={`bg-swatch ${bg.value === 'transparent' ? 'checkerboard' : ''}`}
                  style={{ backgroundColor: bg.value }}
                >
                  {background === bg.value && (
                    <Check size={12} color={bg.value === '#18181d' ? '#fff' : '#36313e'} />
                  )}
                </span>
                {bg.name}
              </button>
            ))}
          </div>
        </div>
        <div className="info-note">
          <FileJson size={17} />
          <span>
            Новый холст откроется в отдельной вкладке.
            <br />
            <button type="button" className="text-button" onClick={onSave}>
              Сохранить текущий PSD
            </button>
          </span>
        </div>
        {!valid && <p className="error-text">Размер каждой стороны — от 1 до 4096 пикселей.</p>}
        <footer className="dialog-footer">
          <span>RGB · 8 бит · sRGB</span>
          <button type="submit" className="primary-button" disabled={!valid}>
            Создать проект
            <ArrowUpRight size={16} />
          </button>
        </footer>
      </form>
    </Modal>
  )
}

export function ExportDialog({
  doc,
  onClose,
  onSave,
  onToast,
}: {
  doc: EditorDocument
  onClose: () => void
  onSave: () => void
  onToast: (s: string) => void
}) {
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp' | 'psd' | 'psb'>('png')
  const layered = format === 'psd' || format === 'psb'
  const [scale, setScale] = useState(1)
  const [quality, setQuality] = useState(95)
  const [transparent, setTransparent] = useState(doc.background === 'transparent')
  const [profileId, setProfileId] = useState(WORKING_RGB_PROFILE.id)
  const [embedProfile, setEmbedProfile] = useState(true)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const background = layered
    ? doc.background
    : transparent && format !== 'jpeg'
      ? 'transparent'
      : doc.background === 'transparent'
        ? '#ffffff'
        : doc.background
  useEffect(() => {
    let disposed = false
    exportCanvas(
      { ...doc, background },
      Math.min(1, 500 / doc.width, 310 / doc.height),
      format === 'jpeg' ? '#ffffff' : undefined,
    )
      .then((c) => {
        if (!disposed) setPreview(c.toDataURL())
      })
      .catch(() => {
        if (!disposed) setError('Не удалось подготовить предпросмотр')
      })
    return () => {
      disposed = true
    }
  }, [doc, background, format])
  const runExport = async () => {
    setBusy(true)
    setError('')
    try {
      if (layered) {
        const { exportPsd } = await import('../engine/psd')
        const blob = await exportPsd(doc, format === 'psb')
        const filename = await downloadBlob(
          blob,
          `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`,
        )
        onToast(
          window.fsh777?.saveFile
            ? `Файл сохранён: ${filename}`
            : `${format.toUpperCase()} со слоями готов к скачиванию`,
        )
        onClose()
        return
      }
      const output = await exportCanvas(
        { ...doc, background },
        scale,
        format === 'jpeg' ? '#ffffff' : undefined,
      )
      const destination =
        builtinColorProfiles().find((profile) => profile.id === profileId) || WORKING_RGB_PROFILE
      if (!profilesMatch(destination, WORKING_RGB_PROFILE)) {
        const ctx = output.getContext('2d')
        if (!ctx) throw new Error('Не удалось подготовить холст для преобразования профиля')
        const pixels = ctx.getImageData(0, 0, output.width, output.height)
        createColorTransform(WORKING_RGB_PROFILE, destination, { dither: true }).transformPixels(
          pixels.data,
          output.width,
          output.height,
        )
        ctx.putImageData(pixels, 0, 0)
      }
      let blob = await canvasBlob(output, `image/${format}`, quality / 100)
      if (embedProfile && (format === 'png' || format === 'jpeg')) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const profile = buildIccProfile(destination)
        const tagged =
          format === 'png'
            ? await embedPngIccProfile(bytes, destination.name, profile)
            : embedJpegIccProfile(bytes, profile)
        blob = new Blob([tagged.slice()], { type: `image/${format}` })
      }
      const filename = await downloadBlob(
        blob,
        `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.${format === 'jpeg' ? 'jpg' : format}`,
      )
      onToast(
        window.fsh777?.saveFile
          ? `Файл сохранён: ${filename}`
          : `Готово! ${format.toUpperCase()} · ${Math.round(doc.width * scale)} × ${Math.round(doc.height * scale)} · ${(blob.size / 1024 / 1024).toFixed(2)} МБ · ${destination.name}${embedProfile && format !== 'webp' ? ' ICC' : ''}`,
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка экспорта')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Пора показать миру"
      subtitle="Твоя работа. В лучшем качестве. Без водяных знаков."
      onClose={busy ? () => {} : onClose}
    >
      <div className="export-preview checkerboard">
        {preview ? (
          <img src={preview} alt="Предпросмотр экспортируемого изображения" />
        ) : (
          <LoaderCircle className="spin" size={24} />
        )}
      </div>
      <div className="export-file-info">
        <FileImage size={16} />
        <span>{doc.name}</span>
        <span>
          {Math.round(doc.width * scale)} × {Math.round(doc.height * scale)} px
        </span>
      </div>
      <div className="format-options">
        {(['png', 'jpeg', 'webp', 'psd', 'psb'] as const).map((f) => (
          <button
            key={f}
            className={format === f ? 'selected' : ''}
            onClick={() => {
              setFormat(f)
              if (f === 'psd' || f === 'psb') setScale(1)
            }}
          >
            <strong>{f === 'jpeg' ? 'JPG' : f.toUpperCase()}</strong>
            <span>
              {f === 'png'
                ? 'Без потерь'
                : f === 'jpeg'
                  ? 'Для фото'
                  : f === 'psd' || f === 'psb'
                    ? 'Со слоями'
                    : 'Для веба'}
            </span>
            {format === f && <Check size={14} />}
          </button>
        ))}
      </div>
      <div className="export-options" style={layered ? { display: 'none' } : undefined}>
        <label className="dialog-label">
          Масштаб
          <Select
            aria-label="Масштаб экспорта"
            value={scale}
            onChange={(e) => setScale(+e.target.value)}
          >
            <option value={0.5}>0.5× — уменьшенный</option>
            <option value={1}>1× — оригинальный</option>
            <option value={2} disabled={doc.width * doc.height * 4 > 32_000_000}>
              2× — увеличенный
            </option>
          </Select>
        </label>
        <label className={`checkbox-row ${format === 'jpeg' ? 'muted' : ''}`}>
          <input
            type="checkbox"
            checked={transparent && format !== 'jpeg'}
            disabled={format === 'jpeg'}
            onChange={(e) => setTransparent(e.target.checked)}
          />
          Прозрачный холст
        </label>
        <label className="dialog-label">
          Профиль назначения
          <Select
            aria-label="Профиль назначения экспорта"
            value={format === 'webp' ? WORKING_RGB_PROFILE.id : profileId}
            disabled={format === 'webp'}
            onChange={(e) => setProfileId(e.target.value)}
          >
            {builtinColorProfiles().map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        </label>
        <label className={`checkbox-row ${format === 'webp' ? 'muted' : ''}`}>
          <input
            type="checkbox"
            checked={embedProfile && format !== 'webp'}
            disabled={format === 'webp'}
            onChange={(e) => setEmbedProfile(e.target.checked)}
          />
          Встроить ICC в PNG/JPEG
        </label>
        <p className="panel-note">
          {format === 'webp'
            ? 'WebP в этой версии остаётся sRGB без встраивания ICC; для другого профиля выбери PNG или JPEG.'
            : 'Плоская копия действительно пересчитывается из рабочего sRGB в выбранный профиль. Предпросмотр выше показывает ожидаемый внешний вид, а не сырые числа другого пространства.'}
        </p>
      </div>
      {!layered && format !== 'png' && (
        <Slider
          label="Качество"
          value={quality}
          min={10}
          max={100}
          suffix="%"
          onChange={setQuality}
        />
      )}
      {layered && (
        <div className="info-note">
          <FileJson size={16} />
          <span>
            RGB / 8 бит · профиль документа: {documentColorProfileLabel(doc)}. Пересобранный PSD
            встраивает sRGB ICC либо явно помечается без профиля. Поддерживаемые текст, векторные
            фигуры, корректирующие слои, группы и маски сохраняются настоящими структурами PSD.
            Сложные преобразования могут использовать редактируемый вложенный PSD. Шрифты не
            встраиваются. Преобразования и ограничения перечислены в «Отчёт PSD» после сохранения;
            XMP — дополнительные данные.
          </span>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="text-button" onClick={onSave}>
          <FileJson size={14} />
          Сохранить PSD
        </button>
        <button className="primary-button" onClick={runExport} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
          {busy ? 'Экспортируем…' : `Скачать ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}`}
        </button>
      </footer>
    </Modal>
  )
}

const shortcuts = [
  ['Перемещение', 'V'],
  ['Выделение', 'M'],
  ['Кадрирование', 'C'],
  ['Кисть / ластик', 'B / E'],
  ['Волшебная палочка', 'W'],
  ['Волшебный ластик', 'Shift E'],
  ['Лассо и подтипы', 'L / Shift L'],
  ['Быстрая маска', 'Q'],
  ['Поиск команд', 'Ctrl F'],
  ['Уровни / кривые / HSL', 'Ctrl L / M / U'],
  ['Добавить / вычесть / пересечь выделение', 'Shift / Alt / Shift Alt'],
  ['Инвертировать выделение', 'Ctrl Shift I'],
  ['Повторить выделение', 'Ctrl Shift D'],
  ['Линейки / направляющие', 'Ctrl R / Ctrl ;'],
  ['Сетка / привязка', "Ctrl ' / Ctrl Shift ;"],
  ['Последний растровый фильтр', 'Ctrl Alt F'],
  ['Текст / текстовая рамка', 'T / Shift T'],
  ['Восстановление области', 'J / Shift J'],
  ['Запись / завершение операции', 'Ctrl Alt R'],
  ['Фигуры и подтипы', 'U / Shift U'],
  ['Перо / подтипы', 'P / Shift P'],
  ['Узлы контура', 'A'],
  ['Закончить / замкнуть путь', 'Enter / Shift Enter'],
  ['Контур в выделение', 'Ctrl Enter'],
  ['Пипетка', 'I'],
  ['Рука', 'H / Пробел'],
  ['Отменить', 'Ctrl Z'],
  ['Повторить', 'Ctrl Shift Z'],
  ['Дублировать слой', 'Ctrl J'],
  ['Копия перетаскиванием', 'Alt + мышь'],
  ['Свободное растяжение', 'Shift + угол'],
  ['Перспектива / скос', 'Ctrl + маркер'],
  ['Копировать / вставить слой', 'Ctrl C / V'],
  ['Новый пустой слой', 'Ctrl Shift N'],
  ['Объединить видимые', 'Ctrl Shift E'],
  ['Инверсия пикселей / активной маски', 'Ctrl I'],
  ['Обесцветить', 'Ctrl Shift U'],
  ['Показать трансформацию', 'Ctrl T'],
  ['Удалить слой', 'Delete'],
  ['Открыть файл', 'Ctrl O'],
  ['Сохранить проект', 'Ctrl S'],
  ['Экспортировать', 'Ctrl Shift S'],
  ['По размеру окна', 'Ctrl 0'],
  ['Масштаб 100%', 'Ctrl 1'],
  ['Снять выделение', 'Ctrl D / Esc'],
  ['Двигать слой', '← ↑ ↓ →'],
  ['Шаг 10 пикселей', 'Shift + стрелка'],
  ['Размер кисти', '[ / ]'],
]
export function HelpDialog({
  onClose,
  initialTab = 'shortcuts',
}: {
  onClose: () => void
  initialTab?: 'shortcuts' | 'about'
}) {
  const [tab, setTab] = useState(initialTab)
  return (
    <Modal
      title="Твоя студия. Твои правила."
      subtitle="ФШ777 ULTRA / независимый графический редактор"
      onClose={onClose}
      wide
    >
      <div className="help-tabs">
        <button
          className={tab === 'shortcuts' ? 'selected' : ''}
          onClick={() => setTab('shortcuts')}
        >
          <Keyboard size={15} />
          Горячие клавиши
        </button>
        <button className={tab === 'about' ? 'selected' : ''} onClick={() => setTab('about')}>
          <Sparkles size={15} />О редакторе
        </button>
      </div>
      {tab === 'shortcuts' ? (
        <>
          <div className="shortcut-grid">
            {shortcuts.map(([name, key]) => (
              <div key={name}>
                <span>{name}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
          </div>
          <p className="help-footnote">
            На macOS используй ⌘ вместо Ctrl. Двойной клик по тексту — редактирование. Угловые
            маркеры сохраняют пропорции без Shift; Shift даёт свободное растяжение. Ctrl + угол —
            перспектива, Ctrl + боковой маркер — скос. При рисовании фигур Shift задаёт
            квадрат/круг; при перемещении ограничивает ось. Файлы можно перетаскивать и вставлять из
            буфера обмена.
          </p>
        </>
      ) : (
        <div className="about-content">
          <div className="about-hero">
            <div className="about-777">
              <BrandMark size={88} />
            </div>
            <div>
              <span className="eyebrow">МЕНЬШЕ ЛИШНЕГО. БОЛЬШЕ ТВОЕГО.</span>
              <h3>
                Идеи не должны
                <br />
                ждать загрузки.
              </h3>
            </div>
          </div>
          <div className="about-feature">
            <LockKeyhole size={20} />
            <div>
              <strong>Твои файлы остаются у тебя</strong>
              <p>
                Редактирование происходит локально на устройстве — в приложении или браузере.
                Изображения не загружаются на сервер. Последний проект автоматически сохраняется в
                IndexedDB на этом устройстве. Для надёжного хранения сохрани файл PSD.
              </p>
            </div>
          </div>
          <div className="about-feature">
            <Sparkles size={20} />
            <div>
              <strong>Честно о возможностях</strong>
              <p>
                Текст с измерением реальных границ, фигуры с заливкой, обводкой и четырьмя
                радиусами; нативные текстовые и векторные слои PSD. Поддерживаемое вложенное
                PSD-содержимое редактируется в смарт-вкладках. Отчёт сохранения показывает
                преобразования и ограничения. В 0.7 доступны перо и редактор узлов, 15
                корректирующих типов, карты градиента, фотофильтр, CUBE LUT и вычисления в числовых
                полях. В 0.8 ULTRA: несколько обводок и теней с порядком, внутренние тень/свечение,
                честный Fill, полные градиенты с прозрачностью, серединами и воспроизводимым шумом
                RGB/HSB/Lab, библиотеки стилей и градиентов, пакетная обработка копий файлов.
                Сохранены кривые и гистограмма, комбинированные выделения, быстрая маска, цветовой
                диапазон, native направляющие, компоновка и поиск команд. Шесть растровых фильтров
                создают копию с сохранением оригинала. Рамки, J и запись операций сохранены; OCR и
                генеративного ИИ нет.
              </p>
            </div>
          </div>
          <div className="about-feature">
            <ShieldCheck size={20} />
            <div>
              <strong>Независимый редактор</strong>
              <p>
                Собственные интерфейс, код и формат проекта. Не связан с Adobe. PSD/PSB
                поддерживаются частично: RGB / 8 бит, до 4096 × 4096. PSD открывается сразу; после
                открытия доступен отчёт о преобразованиях, а отдельный вопрос задаётся только о
                несовпадающем или отсутствующем цветовом профиле. Собственное смарт-содержимое
                редактируется в отдельной вкладке; произвольные Adobe-фильтры, RAW, CMYK и плагины
                не поддерживаются. Лицензии встроенных шрифтов и зависимостей включены в приложение.
              </p>
            </div>
          </div>
          <p className="help-footnote">
            Версия {appVersion} · Холст до 4096 × 4096 px · До 100 слоёв · История 10–100 действий
            <br />
            Независимая реализация снижает риски копирования, но не является юридической гарантией.
          </p>
        </div>
      )}
      <footer className="dialog-footer">
        <span>Создавай то, чего ещё нет.</span>
        <button className="primary-button" onClick={onClose}>
          Вернуться к идеям
          <ArrowUpRight size={15} />
        </button>
      </footer>
    </Modal>
  )
}

export function ReplaceDialog({
  name,
  onSave,
  onConfirm,
  onClose,
}: {
  name: string
  onSave: () => void
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Открыть другой проект?"
      subtitle={`«${name}» будет открыт в новой вкладке.`}
      onClose={onClose}
    >
      <div className="info-note">
        <ArrowDownToLine size={20} />
        <span>
          Остальные вкладки сохранят свою историю. Для надёжного хранения сохрани важные проекты в
          PSD: локальная автокопия не заменяет файл на диске.
        </span>
      </div>
      <button className="secondary-button save-before-replace" onClick={onSave}>
        <FileJson size={16} />
        Сохранить текущий PSD
      </button>
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          <X size={15} />
          Остаться
        </button>
        <button className="primary-button" onClick={onConfirm}>
          Открыть проект
          <ArrowUpRight size={15} />
        </button>
      </footer>
    </Modal>
  )
}
