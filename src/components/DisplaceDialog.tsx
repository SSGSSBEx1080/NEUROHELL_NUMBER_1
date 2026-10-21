import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorDocument, Layer, Selection } from '../types'
import { uid } from '../engine/document'
import {
  defaultDisplaceOptions,
  parseDisplaceOptions,
  MAX_DISPLACEMENT_MAP_PIXELS,
  type DisplaceFitRect,
  type DisplaceOptions,
} from '../engine/displace'
import { runDisplace } from '../engine/displaceJob'
import { prepareFilterSource, processedCopy, type FilterSource } from '../engine/filterLayers'
import { loadImage } from '../engine/render'
import { Modal, Select, SliderField } from './ui'

interface DisplacementMapData {
  id: string
  name: string
  width: number
  height: number
  pixels: Uint8ClampedArray
  canvas: HTMLCanvasElement
}

const validateMapSize = (width: number, height: number) => {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > MAX_DISPLACEMENT_MAP_PIXELS
  )
    throw new Error('Карта смещения: до 8 Мп и 4096 px по стороне.')
}

const mapFromCanvas = (name: string, canvas: HTMLCanvasElement): DisplacementMapData => {
  validateMapSize(canvas.width, canvas.height)
  const pixels = canvas
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height).data
  return { id: uid(), name, width: canvas.width, height: canvas.height, pixels, canvas }
}

const mapFromImage = (
  name: string,
  image: HTMLImageElement | HTMLCanvasElement,
): DisplacementMapData => {
  const width = (image as HTMLImageElement).naturalWidth || image.width,
    height = (image as HTMLImageElement).naturalHeight || image.height
  validateMapSize(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(image, 0, 0)
  return mapFromCanvas(name, canvas)
}

const readFileDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл карты'))
    reader.readAsDataURL(file)
  })

export function DisplaceDialog({
  doc,
  id,
  selection,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  id: string
  selection: Selection | null
  onApply: (copy: Layer, hideOriginal: boolean) => void
  onClose: () => void
}) {
  const [source, setSource] = useState<FilterSource | null>(null),
    [map, setMap] = useState<DisplacementMapData | null>(null),
    [mapLayerId, setMapLayerId] = useState(''),
    [options, setOptions] = useState<DisplaceOptions>(defaultDisplaceOptions),
    [result, setResult] = useState<{
      key: string
      pixels: Uint8ClampedArray
      maxDisplacement: number
    } | null>(null),
    [working, setWorking] = useState(false),
    [mapLoading, setMapLoading] = useState(false),
    [applying, setApplying] = useState(false),
    [hideOriginal, setHideOriginal] = useState(true),
    [split, setSplit] = useState(50),
    [error, setError] = useState('')
  const before = useRef<HTMLCanvasElement>(null),
    after = useRef<HTMLCanvasElement>(null),
    mapPreview = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    alive = useRef(true),
    applyingRef = useRef(false),
    mapLoadRef = useRef(0)
  const mapLayers = doc.layers.filter((layer) => layer.kind === 'image' && layer.src)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let valid = true
    void prepareFilterSource(doc, id, selection)
      .then((value) => {
        if (valid) setSource(value)
      })
      .catch((e) => {
        if (valid) setError(e instanceof Error ? e.message : 'Не удалось подготовить слой')
      })
    return () => {
      valid = false
    }
  }, [doc, id, selection])

  const fitRect = useMemo<DisplaceFitRect | undefined>(() => {
    if (!source) return undefined
    const { canvas, mask } = source,
      w = canvas.width,
      h = canvas.height
    if (!mask) return { x: 0, y: 0, width: w, height: h }
    let minX = w,
      minY = h,
      maxX = -1,
      maxY = -1
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (mask[y * w + x]) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
    return maxX < minX
      ? { x: 0, y: 0, width: w, height: h }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
  }, [source])

  const key =
    map && fitRect ? `${map.id}:${JSON.stringify(options)}:${JSON.stringify(fitRect)}` : ''

  useEffect(() => {
    if (!source || !map || !fitRect) {
      setWorking(false)
      setResult(null)
      return
    }
    const controller = new AbortController()
    setWorking(true)
    setError('')
    const timer = setTimeout(
      () =>
        void runDisplace(
          {
            width: source.canvas.width,
            height: source.canvas.height,
            pixels: source.pixels,
            mapWidth: map.width,
            mapHeight: map.height,
            mapPixels: map.pixels,
            mask: source.mask,
            fitRect,
            options,
          },
          controller.signal,
        )
          .then((value) => setResult({ key, ...value }))
          .catch((e) => {
            if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ошибка')
          })
          .finally(() => {
            if (!controller.signal.aborted) setWorking(false)
          }),
      150,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, map, fitRect, options, key])

  const scale = source ? Math.min(1, 520 / source.canvas.width, 300 / source.canvas.height) : 1,
    w = source ? Math.max(1, Math.round(source.canvas.width * scale)) : 320,
    h = source ? Math.max(1, Math.round(source.canvas.height * scale)) : 200,
    mapScale = map ? Math.min(1, 180 / map.width, 110 / map.height) : 1,
    mapW = map ? Math.max(1, Math.round(map.width * mapScale)) : 180,
    mapH = map ? Math.max(1, Math.round(map.height * mapScale)) : 110

  useEffect(() => {
    if (source && before.current) {
      const ctx = before.current.getContext('2d')!
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(source.canvas, 0, 0, w, h)
    }
  }, [source, w, h])

  useEffect(() => {
    if (!source || !result) return
    const canvas = document.createElement('canvas')
    canvas.width = source.canvas.width
    canvas.height = source.canvas.height
    canvas
      .getContext('2d')!
      .putImageData(
        new ImageData(new Uint8ClampedArray(result.pixels), canvas.width, canvas.height),
        0,
        0,
      )
    const target = after.current?.getContext('2d')
    if (target) {
      target.clearRect(0, 0, w, h)
      target.drawImage(canvas, 0, 0, w, h)
    }
  }, [source, result, w, h])

  useEffect(() => {
    if (!map || !mapPreview.current) return
    const ctx = mapPreview.current.getContext('2d')!
    ctx.clearRect(0, 0, mapW, mapH)
    ctx.drawImage(map.canvas, 0, 0, mapW, mapH)
  }, [map, mapW, mapH])

  const beginMapLoad = () => {
    const loadId = ++mapLoadRef.current
    setMapLoading(true)
    setWorking(false)
    setResult(null)
    setError('')
    return loadId
  }
  const finishMapLoad = (loadId: number, value: DisplacementMapData | null) => {
    if (!alive.current || loadId !== mapLoadRef.current) return
    setMap(value)
    setMapLoading(false)
  }

  const loadMapFile = async (file: File) => {
    const loadId = beginMapLoad()
    try {
      let next: DisplacementMapData
      if (/\.(psd|psb)$/i.test(file.name)) {
        if (file.size > 80 * 1024 * 1024) throw new Error('PSD/PSB карты: файл до 80 МБ')
        const { readPsdCompositePixels } = await import('../engine/psd'),
          composite = await readPsdCompositePixels(await file.arrayBuffer())
        validateMapSize(composite.width, composite.height)
        const canvas = document.createElement('canvas')
        canvas.width = composite.width
        canvas.height = composite.height
        canvas
          .getContext('2d', { willReadFrequently: true })!
          .putImageData(
            new ImageData(
              new Uint8ClampedArray(composite.pixels),
              composite.width,
              composite.height,
            ),
            0,
            0,
          )
        next = {
          id: uid(),
          name: file.name,
          width: composite.width,
          height: composite.height,
          pixels: composite.pixels,
          canvas,
        }
      } else if (
        /^image\/(png|jpeg|webp)$/.test(file.type) ||
        /\.(png|jpe?g|webp)$/i.test(file.name)
      ) {
        if (file.size > 25 * 1024 * 1024) throw new Error('Файл карты должен быть меньше 25 МБ')
        next = mapFromImage(file.name, await loadImage(await readFileDataUrl(file)))
      } else throw new Error('Нужна карта PSD/PSB, PNG, JPEG или WebP')
      if (!alive.current || loadId !== mapLoadRef.current) return
      setMapLayerId('')
      finishMapLoad(loadId, next)
    } catch (e) {
      if (alive.current && loadId === mapLoadRef.current) {
        setMap(null)
        setError(e instanceof Error ? e.message : 'Не удалось прочитать карту смещения')
        setMapLoading(false)
      }
    }
  }

  const loadMapLayer = async (layerId: string) => {
    setMapLayerId(layerId)
    if (!layerId) {
      mapLoadRef.current++
      setMap(null)
      setResult(null)
      setMapLoading(false)
      return
    }
    const layer = mapLayers.find((candidate) => candidate.id === layerId)
    if (!layer?.src) {
      setError('У выбранного слоя нет растрового источника карты')
      return
    }
    const loadId = beginMapLoad()
    try {
      const next = mapFromImage(`Слой: ${layer.name}`, await loadImage(layer.src))
      finishMapLoad(loadId, next)
    } catch (e) {
      if (alive.current && loadId === mapLoadRef.current) {
        setMap(null)
        setError(e instanceof Error ? e.message : 'Не удалось прочитать слой карты')
        setMapLoading(false)
      }
    }
  }

  const patch = (values: Partial<DisplaceOptions>) => {
    setError('')
    setOptions(parseDisplaceOptions({ ...options, ...values }))
  }

  const apply = async () => {
    if (
      !source ||
      !result ||
      result.key !== key ||
      result.maxDisplacement < 0.01 ||
      applyingRef.current
    )
      return
    applyingRef.current = true
    setApplying(true)
    try {
      const copy = await processedCopy(source, result.pixels, 'Смещение по карте')
      if (alive.current) onApply(copy, hideOriginal)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Не удалось создать копию')
    } finally {
      applyingRef.current = false
      if (alive.current) setApplying(false)
    }
  }

  const identity = !!result && result.key === key && result.maxDisplacement < 0.01

  return (
    <Modal
      title="Смещение по карте на копии"
      subtitle="Красный канал карты двигает по горизонтали, зелёный — по вертикали; 128 нейтрален. Оригинал сохраняется слоем, результат — растровая копия, не Smart Filter."
      onClose={onClose}
      wide
    >
      <div className="filter-preview-wrap">
        <div className="filter-comparison checkerboard" style={{ width: w, height: h }}>
          <canvas ref={before} data-testid="displace-before" width={w} height={h} />
          <canvas
            ref={after}
            data-testid="displace-after"
            width={w}
            height={h}
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
          <span className="filter-comparison-line" style={{ left: `${split}%` }} />
        </div>
      </div>
      <label className="filter-compare-slider">
        До / после
        <input
          type="range"
          aria-label="Сравнение смещения"
          min={0}
          max={100}
          value={split}
          onChange={(e) => setSplit(+e.target.value)}
        />
      </label>
      <p className="panel-note">
        {source ? `${source.canvas.width} × ${source.canvas.height}` : 'Подготовка…'} ·{' '}
        {selection ? 'выделение масштабирует смещение' : 'весь слой'} ·{' '}
        {mapLoading
          ? 'читаем карту…'
          : working
            ? 'вычисление…'
            : result && result.key === key
              ? `макс. смещение ${result.maxDisplacement.toFixed(1)} px`
              : 'карта не рассчитана'}
      </p>

      <fieldset disabled={!source || applying} className="properties-fieldset">
        <div className="displace-map-row">
          <div className="displace-map-preview checkerboard" style={{ width: mapW, height: mapH }}>
            {map ? (
              <canvas
                ref={mapPreview}
                data-testid="displace-map-preview"
                width={mapW}
                height={mapH}
              />
            ) : (
              <span>Карта не выбрана</span>
            )}
          </div>
          <div className="displace-map-controls">
            <Select
              aria-label="Слой карты смещения"
              value={mapLayerId}
              disabled={mapLoading}
              onChange={(e) => void loadMapLayer(e.target.value)}
            >
              <option value="">Файл карты или не выбрана</option>
              {mapLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  Слой: {layer.name}
                </option>
              ))}
            </Select>
            <button
              type="button"
              className="secondary-button"
              disabled={mapLoading}
              onClick={() => fileInput.current?.click()}
            >
              {mapLoading ? 'Читаем карту…' : 'Файл карты…'}
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              aria-label="Файл карты смещения"
              accept=".psd,.psb,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void loadMapFile(file)
              }}
            />
            <span className="displace-map-name">
              {map
                ? `${map.name} · ${map.width} × ${map.height}`
                : 'PSD/PSB или обычное изображение'}
            </span>
          </div>
        </div>

        <div className="filter-parameters">
          <SliderField
            label="Горизонтальный масштаб"
            suffix="%"
            value={options.horizontalScale}
            min={-999}
            max={999}
            step={0.1}
            onChange={(value) => patch({ horizontalScale: value })}
          />
          <SliderField
            label="Вертикальный масштаб"
            suffix="%"
            value={options.verticalScale}
            min={-999}
            max={999}
            step={0.1}
            onChange={(value) => patch({ verticalScale: value })}
          />
          <Select
            aria-label="Размещение карты смещения"
            value={options.fit}
            onChange={(e) => patch({ fit: e.target.value as DisplaceOptions['fit'] })}
          >
            <option value="stretch">Растянуть по области</option>
            <option value="tile">Плитка</option>
          </Select>
          <Select
            aria-label="Неопределённые области смещения"
            value={options.edges}
            onChange={(e) => patch({ edges: e.target.value as DisplaceOptions['edges'] })}
          >
            <option value="repeat">Повторять краевые пиксели</option>
            <option value="wrap">Переносить через противоположный край</option>
          </Select>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={hideOriginal}
            onChange={(e) => setHideOriginal(e.target.checked)}
          />
          Скрыть оригинал после применения
        </label>
      </fieldset>

      <p className="panel-note">
        Чёрное двигает вправо/вниз, белое — влево/вверх; при масштабе 100% максимум 128 px. Синий
        канал игнорируется, прозрачность карты компонуется на белый. PSD-карта читается по сводному
        изображению Maximize Compatibility; карта-слой берёт его локальные пиксели до трансформаций,
        маски и стилей. При выделении карта размещается по его ограничивающей рамке.
      </p>
      <p className="panel-note">
        До 8 Мп / 4096 px для слоя и карты, до 20 секунд на расчёт в worker. Это независимая
        обратная билинейная деформация RGB/8, а не редактируемый Adobe Smart Filter.
      </p>
      {identity && (
        <p className="panel-note">
          Эта карта и масштабы не дают видимого смещения — копия не создаётся.
        </p>
      )}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={
            applying ||
            mapLoading ||
            working ||
            !result ||
            result.key !== key ||
            identity ||
            !!error
          }
          onClick={() => void apply()}
        >
          {applying ? 'Создаём копию…' : 'Применить на копии'}
        </button>
      </footer>
    </Modal>
  )
}
