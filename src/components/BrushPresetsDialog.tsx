import { useMemo, useRef, useState } from 'react'
import { Brush, Circle, Download, ImagePlus, Library, Save, Trash2, Upload } from 'lucide-react'
import type { ToolSettings } from '../types'
import { Modal, Select, SliderField } from './ui'
import { downloadBlob, loadImage } from '../engine/render'
import {
  brushPresetFromAbrImport,
  brushPresetId,
  brushSettingsFromToolSettings,
  builtinBrushPresets,
  downscaleBrushAlpha,
  encodeBrushAlphaTip,
  loadBrushLibrary,
  parseBrushLibrary,
  rgbaToBrushAlpha,
  saveBrushLibrary,
  serializeBrushLibrary,
  toolSettingsForBrushPreset,
  type AbrImportedPreset,
  type BrushPreset,
} from '../engine/brushPresets'

type ImportedDisplay = AbrImportedPreset & { preview?: string }
const IMPORTED_DISPLAY_LIMIT = 192

function tipPreview(preset: {
  settings: BrushPreset['settings']
  tip?: BrushPreset['tip']
  preview?: string
}) {
  const src = preset.tip?.src || preset.preview
  if (src) return <img src={src} alt="" draggable={false} />
  const roundness = (preset.settings.brushRoundness ?? 100) / 100,
    angle = preset.settings.brushAngle ?? 0
  return (
    <span
      className="brush-preset-round-preview"
      style={{ transform: `rotate(${angle}deg) scaleY(${Math.max(0.08, roundness)})` }}
    />
  )
}

export function BrushPresetsDialog({
  settings,
  onSettings,
  onClose,
}: {
  settings: ToolSettings
  onSettings: (patch: Partial<ToolSettings>) => void
  onClose: () => void
}) {
  const [library, setLibrary] = useState<BrushPreset[]>(() => loadBrushLibrary()),
    [imported, setImported] = useState<ImportedDisplay[]>([]),
    [name, setName] = useState(settings.brushTip?.name || 'Моя кисть'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    abrFile = useRef<HTMLInputElement>(null),
    imageFile = useRef<HTMLInputElement>(null),
    jsonFile = useRef<HTMLInputElement>(null)
  const currentTipName = settings.brushTip?.name || 'Круглый наконечник',
    importedVisible = useMemo(() => imported.slice(0, IMPORTED_DISPLAY_LIMIT), [imported])
  const set = (patch: Partial<ToolSettings>) => onSettings(patch),
    applyPreset = async (preset: BrushPreset) => {
      if (preset.tip) {
        try {
          // Decode now, while the user is still in the dialog. CanvasStage can
          // then build the sampled stamp synchronously from the image cache,
          // including for a very short click.
          await loadImage(preset.tip.src)
        } catch {
          setMessage(`Наконечник «${preset.name}» не загрузился и не применён.`)
          return
        }
      }
      onSettings(toolSettingsForBrushPreset(preset, settings))
      setName(preset.name)
      setMessage(
        preset.unsupported?.length
          ? `Применено «${preset.name}». Не поддерживается: ${preset.unsupported.join(', ')}.`
          : `Применено «${preset.name}».`,
      )
    },
    persistLibrary = (next: BrushPreset[]) => {
      const capped = next.slice(-64)
      setLibrary(capped)
      return saveBrushLibrary(capped)
    },
    addToLibrary = (preset: BrushPreset) => {
      const saved = persistLibrary([
        ...library.filter((x) => x.id !== preset.id && x.name !== preset.name),
        {
          ...preset,
          source: 'library',
        },
      ])
      setMessage(
        saved
          ? `«${preset.name}» сохранена в локальной библиотеке.`
          : `«${preset.name}» видна до перезагрузки, но не поместилась в локальное хранилище браузера. Удалите несколько пресетов или экспортируйте библиотеку JSON.`,
      )
    }

  const importAbr = async (file: File) => {
    setBusy(true)
    try {
      const { parseAbrBrushes } = await import('../engine/brushAbr'),
        result = parseAbrBrushes(await file.arrayBuffer()),
        displayed = result.presets.map((preset, index) => {
          if (!preset.sample || index >= IMPORTED_DISPLAY_LIMIT) return preset
          try {
            const small = downscaleBrushAlpha(
              preset.sample.alpha,
              preset.sample.bounds.w,
              preset.sample.bounds.h,
              96,
              9216,
            )
            return {
              ...preset,
              preview: encodeBrushAlphaTip(small.alpha, small.width, small.height, preset.name).src,
            }
          } catch {
            return preset
          }
        })
      setImported(displayed)
      const unsupportedCount = result.presets.filter((x) => x.unsupported.length).length
      setMessage(
        `ABR прочитан: ${result.presets.length} пресет(ов).` +
          (unsupportedCount ? ` С честными предупреждениями: ${unsupportedCount}.` : '') +
          (result.warnings.length ? ` ${result.warnings.join(' ')}` : ''),
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ABR не удалось прочитать')
    } finally {
      setBusy(false)
    }
  }

  const importTipImage = async (file: File) => {
    setBusy(true)
    const url = URL.createObjectURL(file)
    try {
      const image = await loadImage(url),
        sourceW = (image as HTMLImageElement).naturalWidth || image.width,
        sourceH = (image as HTMLImageElement).naturalHeight || image.height,
        scale = Math.min(1, 512 / Math.max(sourceW, sourceH)),
        canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(sourceW * scale))
      canvas.height = Math.max(1, Math.round(sourceH * scale))
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
        mask = rgbaToBrushAlpha(pixels.data, canvas.width, canvas.height),
        presetName = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Наконечник из изображения',
        preset: BrushPreset = {
          id: brushPresetId(),
          name: presetName,
          source: 'image',
          tip: encodeBrushAlphaTip(mask.alpha, mask.width, mask.height, presetName),
          settings: {
            brushSize: Math.min(500, Math.max(mask.width, mask.height)),
            brushSpacing: 15,
          },
        }
      await applyPreset(preset)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Изображение наконечника не загрузилось')
    } finally {
      URL.revokeObjectURL(url)
      setBusy(false)
    }
  }

  const saveCurrent = () => {
    const preset: BrushPreset = {
      id: brushPresetId(),
      name: name.trim().slice(0, 80) || 'Моя кисть',
      source: 'library',
      tip: settings.brushTip,
      settings: brushSettingsFromToolSettings(settings),
    }
    addToLibrary(preset)
  }

  const renderPreset = (preset: BrushPreset, removable = false) => (
    <div className="brush-preset-card" key={preset.id}>
      <button
        type="button"
        className="brush-preset-apply"
        onClick={() => void applyPreset(preset)}
        aria-label={`Применить кисть ${preset.name}`}
      >
        <span className="brush-preset-preview">{tipPreview(preset)}</span>
        <span className="brush-preset-name">{preset.name}</span>
        <small>
          {preset.tip
            ? `${preset.tip.width}×${preset.tip.height} sampled`
            : `${Math.round(preset.settings.brushSize ?? settings.brushSize)} px · круглая`}
          {preset.unsupported?.length ? ` · ⚠ ${preset.unsupported.length}` : ''}
        </small>
      </button>
      {removable && (
        <button
          type="button"
          className="compact-button"
          aria-label={`Удалить кисть ${preset.name}`}
          onClick={() => persistLibrary(library.filter((x) => x.id !== preset.id))}
        >
          <Trash2 size={12} /> Удалить
        </button>
      )}
    </div>
  )

  return (
    <Modal
      title="Кисти, наконечники и динамика"
      subtitle="ABR v6/7/9/10 через ag-psd: круглые и sampled-наконечники, форма, рассеивание и поддерживаемая динамика. Текстура, двойная и цветовая динамика честно помечаются, а не подделываются."
      onClose={onClose}
      wide
    >
      <div className="brush-presets-layout">
        <section className="brush-presets-controls">
          <div className="section-heading">
            <h3>
              <Brush size={14} /> Текущая форма
            </h3>
            <span>{currentTipName}</span>
          </div>
          <div className="brush-dynamics-grid">
            <SliderField
              label="Угол"
              suffix="°"
              min={-180}
              max={180}
              value={settings.brushAngle ?? 0}
              onChange={(v) => set({ brushAngle: v })}
            />
            <SliderField
              label="Округлость"
              suffix="%"
              min={1}
              max={100}
              value={settings.brushRoundness ?? 100}
              onChange={(v) => set({ brushRoundness: v })}
            />
            <SliderField
              label="Джиттер размера"
              suffix="%"
              value={settings.brushSizeJitter ?? 0}
              onChange={(v) => set({ brushSizeJitter: v })}
            />
            <SliderField
              label="Мин. диаметр"
              suffix="%"
              value={settings.brushMinimumDiameter ?? 0}
              onChange={(v) => set({ brushMinimumDiameter: v })}
            />
            <SliderField
              label="Джиттер непрозрачности"
              suffix="%"
              value={settings.brushOpacityJitter ?? 0}
              onChange={(v) => set({ brushOpacityJitter: v })}
            />
            <SliderField
              label="Мин. непрозрачность"
              suffix="%"
              value={settings.brushMinimumOpacity ?? 0}
              onChange={(v) => set({ brushMinimumOpacity: v })}
            />
            <SliderField
              label="Джиттер угла"
              suffix="%"
              value={settings.brushAngleJitter ?? 0}
              onChange={(v) => set({ brushAngleJitter: v })}
            />
            <SliderField
              label="Джиттер округлости"
              suffix="%"
              value={settings.brushRoundnessJitter ?? 0}
              onChange={(v) => set({ brushRoundnessJitter: v })}
            />
            <SliderField
              label="Мин. округлость"
              suffix="%"
              min={1}
              max={100}
              value={settings.brushMinimumRoundness ?? 25}
              onChange={(v) => set({ brushMinimumRoundness: v })}
            />
            <SliderField
              label="Рассеивание"
              suffix="%"
              min={0}
              max={1000}
              value={settings.brushScatter ?? 0}
              onChange={(v) => set({ brushScatter: v })}
            />
            <SliderField
              label="Число отпечатков"
              min={1}
              max={16}
              value={settings.brushScatterCount ?? 1}
              onChange={(v) => set({ brushScatterCount: Math.round(v) })}
            />
            <SliderField
              label="Джиттер числа"
              suffix="%"
              value={settings.brushCountJitter ?? 0}
              onChange={(v) => set({ brushCountJitter: v })}
            />
          </div>
          <label className="brush-angle-control">
            <span>Управление углом</span>
            <Select
              aria-label="Управление углом кисти"
              value={settings.brushAngleControl ?? 'off'}
              onChange={(e) =>
                set({ brushAngleControl: e.target.value as ToolSettings['brushAngleControl'] })
              }
            >
              <option value="off">Выключено</option>
              <option value="direction">Направление мазка</option>
              <option value="initial">Начальное направление</option>
            </Select>
          </label>
          <div className="brush-toggle-grid">
            {(
              [
                ['Отразить X', 'brushFlipX'],
                ['Отразить Y', 'brushFlipY'],
                ['Случайно отражать X', 'brushFlipXJitter'],
                ['Случайно отражать Y', 'brushFlipYJitter'],
                ['Рассеивание по двум осям', 'brushScatterBothAxes'],
              ] as const
            ).map(([label, key]) => (
              <label className="mini-check" key={key}>
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={!!settings[key]}
                  onChange={(e) => set({ [key]: e.target.checked })}
                />{' '}
                {label}
              </label>
            ))}
          </div>
          <div className="brush-save-row">
            <input
              aria-label="Название пресета кисти"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="compact-button" onClick={saveCurrent}>
              <Save size={13} /> Сохранить текущую
            </button>
            <button
              type="button"
              className="compact-button"
              onClick={() => set({ brushTip: undefined, brushAngle: 0, brushRoundness: 100 })}
            >
              <Circle size={13} /> Круглая
            </button>
          </div>
        </section>

        <section className="brush-presets-browser">
          <div className="brush-import-row">
            <button
              type="button"
              className="compact-button"
              disabled={busy}
              onClick={() => abrFile.current?.click()}
            >
              <Upload size={13} /> Импорт ABR
            </button>
            <button
              type="button"
              className="compact-button"
              disabled={busy}
              onClick={() => imageFile.current?.click()}
            >
              <ImagePlus size={13} /> Наконечник из изображения
            </button>
            <button
              type="button"
              className="compact-button"
              onClick={() => jsonFile.current?.click()}
            >
              <Library size={13} /> Библиотека JSON
            </button>
            <button
              type="button"
              className="compact-button"
              disabled={!library.length}
              onClick={() =>
                void downloadBlob(
                  new Blob([serializeBrushLibrary(library)], { type: 'application/json' }),
                  'brushes.777brushes.json',
                ).catch((e) => setMessage(e instanceof Error ? e.message : 'Ошибка экспорта'))
              }
            >
              <Download size={13} /> Экспорт библиотеки
            </button>
          </div>
          <input
            ref={abrFile}
            type="file"
            accept=".abr,application/octet-stream"
            hidden
            aria-label="Импорт ABR-кистей"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importAbr(file)
            }}
          />
          <input
            ref={imageFile}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label="Импорт изображения наконечника кисти"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importTipImage(file)
            }}
          />
          <input
            ref={jsonFile}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Импорт библиотеки кистей"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void file
                .text()
                .then((text) => {
                  const parsed = parseBrushLibrary(text)
                  if (!parsed)
                    throw new Error(
                      'Файл библиотеки кистей повреждён или содержит недопустимый наконечник',
                    )
                  const names = new Set(parsed.map((x) => x.name))
                  const saved = persistLibrary([
                    ...library.filter((x) => !names.has(x.name)),
                    ...parsed,
                  ])
                  setMessage(
                    saved
                      ? `Импортировано пресетов в библиотеку: ${parsed.length}.`
                      : `Импортировано пресетов: ${parsed.length}, но библиотека не поместилась в локальное хранилище браузера и не сохранится после перезагрузки.`,
                  )
                })
                .catch((error) =>
                  setMessage(error instanceof Error ? error.message : 'Ошибка импорта библиотеки'),
                )
            }}
          />
          {message && (
            <p className="panel-note" role="status">
              {message}
            </p>
          )}
          <h3>Встроенные</h3>
          <div className="brush-preset-grid">
            {builtinBrushPresets.map((preset) => renderPreset(preset))}
          </div>
          {library.length > 0 && (
            <>
              <h3>Моя библиотека</h3>
              <div className="brush-preset-grid">
                {library.map((preset) => renderPreset(preset, true))}
              </div>
            </>
          )}
          {imported.length > 0 && (
            <>
              <h3>Из ABR-пакета ({imported.length})</h3>
              <div className="brush-preset-grid">
                {importedVisible.map((preset) => (
                  <div className="brush-preset-card" key={preset.id}>
                    <button
                      type="button"
                      className="brush-preset-apply"
                      onClick={() => void applyPreset(brushPresetFromAbrImport(preset))}
                      aria-label={`Применить ABR-кисть ${preset.name}`}
                    >
                      <span className="brush-preset-preview">{tipPreview(preset)}</span>
                      <span className="brush-preset-name">{preset.name}</span>
                      <small>
                        {preset.sample
                          ? `${preset.sample.bounds.w}×${preset.sample.bounds.h} sampled`
                          : `${Math.round(preset.settings.brushSize ?? settings.brushSize)} px · круглая`}
                        {preset.unsupported.length ? ` · ⚠ ${preset.unsupported.length}` : ''}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="compact-button"
                      aria-label={`Сохранить ABR-кисть ${preset.name}`}
                      onClick={() => addToLibrary(brushPresetFromAbrImport(preset))}
                    >
                      <Save size={12} /> В библиотеку
                    </button>
                  </div>
                ))}
              </div>
              {imported.length > IMPORTED_DISPLAY_LIMIT && (
                <p className="panel-note">
                  Показаны первые {IMPORTED_DISPLAY_LIMIT} пресетов пакета.
                </p>
              )}
            </>
          )}
          <p className="panel-note">
            Sampled-наконечники локально уменьшаются максимум до 512 px/262 144 px² для библиотеки и
            производительности; исходный ABR не изменяется. ABR legacy v1/v2, bristle/dynamic/tips,
            текстура, двойная и цветовая динамика не эмулируются молча.
          </p>
          <div className="modal-actions">
            <button type="button" className="primary-button" onClick={onClose}>
              Готово
            </button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
