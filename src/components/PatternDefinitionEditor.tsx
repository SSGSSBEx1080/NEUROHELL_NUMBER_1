import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Upload } from 'lucide-react'
import type { PatternDefinition, PatternKind } from '../types'
import {
  builtinPatternDefinitions,
  createImagePatternDefinition,
  patternContentKey,
  patternTileDataUrl,
  registerPatternTile,
  withPatternPatch,
} from '../engine/patterns'
import { ColorField, Field, Select, Slider } from './ui'

const MAX_UPLOAD_WIDTH = 1024
const MAX_UPLOAD_HEIGHT = 1024
const MAX_UPLOAD_PIXELS = 1_048_576
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const KIND_NAMES: Record<PatternKind, string> = {
  checker: 'Клетки',
  dots: 'Точки',
  stripes: 'Полосы',
  diagonal: 'Диагональ',
  grid: 'Сетка',
  noise: 'Зерно',
  image: 'Изображение',
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл'))
    reader.readAsDataURL(file)
  })
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось декодировать изображение'))
    image.src = src
  })
}

export function PatternDefinitionEditor({
  definition,
  onChange,
  label,
}: {
  definition: PatternDefinition
  onChange: (definition: PatternDefinition) => void
  label: string
}) {
  const presets = useMemo(() => builtinPatternDefinitions(), [])
  const file = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(definition.name)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => setName(definition.name), [definition.name])

  const patch = (next: Partial<PatternDefinition>) => onChange(withPatternPatch(definition, next))
  const presetIndex = presets.findIndex(
    (preset) =>
      preset.name === definition.name &&
      patternContentKey(preset) === patternContentKey(definition),
  )
  const presetValue = presetIndex >= 0 ? String(presetIndex) : 'custom'
  const previewUrl = useMemo(() => patternTileDataUrl(definition), [definition])
  const naturalWidth = definition.kind === 'image' ? definition.width || 1 : definition.size
  const naturalHeight = definition.kind === 'image' ? definition.height || 1 : definition.size
  const previewScale = Math.min(4, Math.max(0.125, 64 / Math.max(naturalWidth, naturalHeight)))
  const upload = async (picked: File) => {
    setBusy(true)
    setError('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(picked.type))
        throw new Error('Для узора поддерживаются PNG, JPEG и WebP')
      if (picked.size > MAX_UPLOAD_BYTES) throw new Error('Файл узора должен быть меньше 10 МБ')
      const source = await readAsDataUrl(picked)
      const image = await loadHtmlImage(source)
      if (
        image.width > MAX_UPLOAD_WIDTH ||
        image.height > MAX_UPLOAD_HEIGHT ||
        image.width * image.height > MAX_UPLOAD_PIXELS
      )
        throw new Error(
          `Плитка загружаемого узора — до ${MAX_UPLOAD_WIDTH}×${MAX_UPLOAD_HEIGHT} и до 1 мегапикселя. Уменьши изображение заранее: редактор не масштабирует его молча.`,
        )
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      canvas.getContext('2d')!.drawImage(image, 0, 0)
      const src = canvas.toDataURL('image/png')
      const next = createImagePatternDefinition({
        name: picked.name.replace(/\.[^.]+$/, '') || 'Загруженный узор',
        src,
        width: image.width,
        height: image.height,
      })
      if (!next) throw new Error('Не удалось создать узор из изображения')
      registerPatternTile(next, canvas)
      onChange(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить узор')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="pattern-definition-editor">
      <div
        className="pattern-preview"
        role="img"
        aria-label={`Предпросмотр: ${definition.name}`}
        style={{
          backgroundImage: previewUrl ? `url(${previewUrl})` : undefined,
          backgroundSize: `${Math.max(1, Math.round(naturalWidth * previewScale))}px ${Math.max(
            1,
            Math.round(naturalHeight * previewScale),
          )}px`,
        }}
      />
      <Select
        aria-label={`${label}: пресет`}
        value={presetValue}
        onChange={(e) => {
          const preset = presets[Number(e.target.value)]
          if (preset) onChange(structuredClone(preset))
        }}
      >
        {presetValue === 'custom' && (
          <option value="custom">
            {definition.kind === 'image' ? 'Изображение' : 'Свой узор'}
          </option>
        )}
        {presets.map((preset, i) => (
          <option value={i} key={preset.id}>
            {preset.name}
          </option>
        ))}
      </Select>
      <label className="dialog-label">
        Название узора
        <input
          className="dialog-input"
          aria-label={`${label}: название`}
          value={name}
          maxLength={120}
          onChange={(e) => {
            const value = e.target.value
            setName(value)
            if (value.trim()) patch({ name: value })
          }}
          onBlur={() => {
            if (!name.trim()) setName(definition.name)
          }}
        />
      </label>
      <Select
        aria-label={`${label}: тип`}
        value={definition.kind}
        onChange={(e) => patch({ kind: e.target.value as PatternKind })}
      >
        {(Object.keys(KIND_NAMES) as PatternKind[]).map((kind) => (
          <option
            value={kind}
            key={kind}
            disabled={kind === 'image' && definition.kind !== 'image'}
          >
            {KIND_NAMES[kind]}
          </option>
        ))}
      </Select>
      {definition.kind === 'image' ? (
        <p className="panel-note">
          Плитка-изображение {definition.width || 0}×{definition.height || 0}. Цвета и исходный
          размер заданы изображением; масштаб эффекта настраивается отдельно.
        </p>
      ) : (
        <>
          <ColorField
            label={`${label}: основной цвет`}
            value={definition.foreground}
            onChange={(foreground) => patch({ foreground })}
          />
          <ColorField
            label={`${label}: цвет фона`}
            value={definition.background}
            onChange={(background) => patch({ background })}
          />
          <Slider
            label="Размер плитки узора"
            value={definition.size}
            min={4}
            max={256}
            suffix=" px"
            onChange={(size) => patch({ size })}
          />
          {definition.kind === 'noise' && (
            <>
              <Field
                label="Seed зерна"
                value={definition.seed}
                min={0}
                max={4_294_967_295}
                onChange={(seed) => patch({ seed: Math.floor(Math.abs(seed)) })}
              />
              <button
                className="compact-button"
                aria-label="Новый seed узора"
                onClick={() => patch({ seed: (Date.now() % 4_294_967_296) >>> 0 })}
              >
                <Dices size={13} /> Новый seed
              </button>
            </>
          )}
        </>
      )}
      <div className="effect-instance-tools">
        <button className="compact-button" disabled={busy} onClick={() => file.current?.click()}>
          <Upload size={13} /> {busy ? 'Загружаем…' : 'Плитка из изображения'}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={`${label}: файл изображения`}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (picked) void upload(picked)
        }}
      />
      {error && (
        <p className="panel-note" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
