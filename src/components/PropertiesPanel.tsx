import { localBounds, worldBounds, resizePointText, rotateVisual } from '../engine/layerGeometry'
import { ShapeProperties } from './ShapeProperties'
import { TextFrameSettings } from './TextFrameSettings'
import { descendants } from '../engine/document'
import { useFonts } from '../hooks/useFonts'
import { useFont } from '../engine/fonts'
import { useLayoutEffect, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronRight,
  FlipHorizontal2,
  FlipVertical2,
  Image,
  Italic,
  Link2,
  LockKeyhole,
  Maximize,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Type,
  Unlink2,
  Upload,
} from 'lucide-react'
import { DEFAULT_ADJUSTMENTS, type Layer, type ToolSettings } from '../types'
import type { Editor } from '../hooks/useEditor'
import { ColorField, Field, IconButton, Select, Slider } from './ui'

interface Props {
  editor: Editor
  layer?: Layer
  onStyle: () => void
  onFonts: () => void
  onExtractText: () => void
  onRemoveBackground: () => void
  onFitLayer: () => void
  onImport: () => void
  onAddText: () => void
  onMask: () => void
  onOpenSmart: () => void
  onParent: (id: string | null) => void
  settings: ToolSettings
  setSettings: (patch: Partial<ToolSettings>) => void
  busy: boolean
}
const presets = [
  { name: 'Оригинал', filter: 'none', values: {} },
  {
    name: 'Кино',
    filter: 'contrast(1.3) saturate(.7)',
    values: { contrast: 25, saturation: -25, brightness: -5 },
  },
  {
    name: 'Сумерки',
    filter: 'hue-rotate(35deg) saturate(.8)',
    values: { hue: 35, saturation: -20, contrast: 12 },
  },
  { name: 'Чёрно-белый', filter: 'grayscale(1)', values: { grayscale: 100, contrast: 10 } },
  {
    name: 'Тёплый',
    filter: 'sepia(.4) saturate(1.3)',
    values: { sepia: 35, saturation: 25, brightness: 5 },
  },
  {
    name: 'Плёнка',
    filter: 'sepia(.25) contrast(.8)',
    values: { sepia: 25, contrast: -20, saturation: -15 },
  },
]

export function PropertiesPanel({
  editor,
  layer,
  onStyle,
  onFonts,
  onExtractText,
  onRemoveBackground,
  onFitLayer,
  onImport,
  onAddText,
  onMask,
  onOpenSmart,
  onParent,
  settings,
  setSettings,
  busy,
}: Props) {
  useLayoutEffect(() => {
    if (layer?.kind === 'text') setTab('properties')
  }, [layer?.id, layer?.kind])
  const fonts = useFonts()
  const [tab, setTab] = useState<'properties' | 'effects'>('properties')
  const [linked, setLinked] = useState(true)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const pointText = layer?.kind === 'text' && !layer.textFrame
  const inkBounds = layer ? localBounds(layer, true) : undefined
  const position = layer && pointText ? worldBounds(layer) : layer
  const doc = editor.document
  const patch = (values: Partial<Layer>, label = 'Свойства слоя', temporary = false) => {
    if (layer && !layer.locked) editor.patchLayer(layer.id, values, label, temporary)
  }
  const adjust = (key: keyof Layer['adjustments'], value: number) =>
    patch({ adjustments: { ...layer!.adjustments, [key]: value } }, '', true)
  const finish = () => editor.finish('Свойства слоя')
  const setDimension = (key: 'width' | 'height', value: number) => {
    if (!layer) return
    if (pointText) {
      const b = localBounds(layer, true),
        ratio = value / b[key]
      patch(
        resizePointText(layer, {
          ...b,
          [key]: value,
          ...(linked
            ? {
                [key === 'width' ? 'height' : 'width']:
                  b[key === 'width' ? 'height' : 'width'] * ratio,
              }
            : {}),
        }),
        '',
        true,
      )
      return
    }
    const ratio = value / layer[key]
    const other = key === 'width' ? 'height' : 'width'
    patch(
      {
        [key]: value,
        ...(linked
          ? {
              [other]: Math.min(16384, Math.max(1, layer[other] * ratio)),
              ...(layer.kind === 'text' && !layer.textFrame
                ? { fontSize: Math.min(1000, Math.max(4, (layer.fontSize || 48) * ratio)) }
                : {}),
            }
          : {}),
      },
      '',
      true,
    )
  }
  return (
    <section className="properties-panel">
      <div className="panel-tabs">
        <button
          className={tab === 'properties' ? 'selected' : ''}
          onClick={() => setTab('properties')}
        >
          Свойства
        </button>
        <button className={tab === 'effects' ? 'selected' : ''} onClick={() => setTab('effects')}>
          <Sparkles size={13} />
          Эффекты
        </button>
      </div>
      <div className="properties-scroll">
        {!layer ? (
          <>
            <div className="object-heading">
              <span className="object-icon">
                <Maximize size={18} />
              </span>
              <div>
                <strong>Холст</strong>
                <span>Пространство для твоих идей</span>
              </div>
              <span className="small-badge">RGB</span>
            </div>
            <div className="property-section">
              <div className="section-heading">
                Размер документа <span>px</span>
              </div>
              <div className="field-grid">
                <Field
                  label="Ш"
                  value={doc.width}
                  min={1}
                  max={4096}
                  onChange={(width) =>
                    editor.change((d) => ({ ...d, width: Math.round(width) }), '', true)
                  }
                  onCommit={() => editor.finish('Размер холста')}
                />
                <Field
                  label="В"
                  value={doc.height}
                  min={1}
                  max={4096}
                  onChange={(height) =>
                    editor.change((d) => ({ ...d, height: Math.round(height) }), '', true)
                  }
                  onCommit={() => editor.finish('Размер холста')}
                />
              </div>
            </div>
            <div className="property-section">
              <div className="section-heading">Цвет фона</div>
              <ColorField
                label="Цвет фона холста"
                value={doc.background}
                onChange={(background) => editor.change((d) => ({ ...d, background }), '', true)}
                onCommit={() => editor.finish('Цвет фона холста')}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={doc.background === 'transparent'}
                  onChange={(e) =>
                    editor.change(
                      (d) => ({ ...d, background: e.target.checked ? 'transparent' : '#ffffff' }),
                      'Прозрачность холста',
                    )
                  }
                />
                Прозрачный фон
              </label>
            </div>
            <div className="property-section">
              <div className="section-heading">С чего начнём?</div>
              <button className="action-button primary-action" onClick={onImport}>
                <Upload size={15} />
                Добавить изображение<span>↗</span>
              </button>
              <button className="action-button" onClick={onAddText}>
                <Type size={15} />
                Добавить текст<span>T</span>
              </button>
              <p className="panel-note">
                Или просто перетащи файл на холст.
                <br />
                PNG, JPEG, WebP — до 25 МБ.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="object-heading">
              <span className="object-icon">
                {layer.kind === 'text' ? (
                  <Type size={18} />
                ) : layer.kind === 'image' ? (
                  <Image size={18} />
                ) : (
                  <Maximize size={18} />
                )}
              </span>
              <div>
                <strong>
                  {layer.smart
                    ? 'Смарт-объект'
                    : layer.kind === 'group'
                      ? 'Группа слоёв'
                      : layer.kind === 'text'
                        ? 'Текстовый слой'
                        : layer.kind === 'image'
                          ? 'Изображение'
                          : 'Фигура'}
                </strong>
                <span>{layer.name}</span>
              </div>
              {layer.locked ? (
                <LockKeyhole size={14} />
              ) : (
                <span className="small-badge">
                  {layer.smart
                    ? 'SMART'
                    : layer.kind === 'group'
                      ? 'ГРУППА'
                      : layer.kind === 'image'
                        ? 'РАСТР'
                        : layer.kind === 'text'
                          ? 'ТЕКСТ'
                          : 'ВЕКТОР'}
                </span>
              )}
            </div>
            {layer.locked && (
              <div className="locked-notice">
                <LockKeyhole size={13} />
                Сними замок слоя, чтобы редактировать
              </div>
            )}
            <button
              className="action-button style-open-button"
              disabled={layer.locked || busy}
              onClick={onStyle}
            >
              <Sparkles size={14} />
              Стиль слоя<span>fx</span>
            </button>
            {layer.smart && (
              <button className="action-button style-open-button" onClick={onOpenSmart}>
                <Image size={14} />
                Редактировать содержимое<span>↗</span>
              </button>
            )}
            {layer.sourceText && (
              <button
                className="action-button style-open-button"
                disabled={layer.locked || busy}
                onClick={onExtractText}
              >
                <Type size={14} />
                Извлечь текст из PSD<span>↗</span>
              </button>
            )}
            <fieldset disabled={layer.locked || busy} className="properties-fieldset">
              {tab === 'properties' ? (
                <>
                  {layer.mask && (
                    <div className="property-section mask-properties">
                      <div className="section-heading">
                        Маска слоя
                        <button
                          className="text-button"
                          onClick={() => patch({ mask: undefined }, 'Удаление маски')}
                        >
                          Удалить
                        </button>
                      </div>
                      <button
                        className={`action-button ${settings.editMask ? 'primary-action' : ''}`}
                        onClick={onMask}
                      >
                        {settings.editMask ? 'Рисуем по маске · кисть' : 'Редактировать маску'}
                      </button>
                      <p className="panel-note">
                        Чёрный скрывает, белый проявляет. X меняет цвета местами. Исходные пиксели
                        не стираются.
                      </p>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={layer.mask.enabled}
                          onChange={(e) =>
                            patch(
                              { mask: { ...layer.mask!, enabled: e.target.checked } },
                              'Включение маски',
                            )
                          }
                        />
                        Маска включена
                      </label>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={layer.mask.linked}
                          onChange={(e) =>
                            patch(
                              { mask: { ...layer.mask!, linked: e.target.checked } },
                              'Связь маски',
                            )
                          }
                        />
                        Перемещать вместе со слоем
                      </label>
                      <Slider
                        label="Плотность маски"
                        value={layer.mask.density * 100}
                        onChange={(v) =>
                          patch({ mask: { ...layer.mask!, density: v / 100 } }, '', true)
                        }
                        onCommit={finish}
                      />
                      <Slider
                        label="Растушёвка маски"
                        value={layer.mask.feather}
                        max={100}
                        suffix=" px"
                        onChange={(v) => patch({ mask: { ...layer.mask!, feather: v } }, '', true)}
                        onCommit={finish}
                      />
                    </div>
                  )}
                  <div className="property-section transform-section">
                    <div className="section-heading">
                      Трансформация
                      <IconButton
                        icon={linked ? Link2 : Unlink2}
                        label={linked ? 'Отключить сохранение пропорций' : 'Сохранять пропорции'}
                        active={linked}
                        onClick={() => setLinked(!linked)}
                      />
                    </div>
                    <div className="field-grid">
                      <Field
                        label="X"
                        value={position!.x}
                        onChange={(x) => patch({ x: layer.x + x - position!.x }, '', true)}
                        onCommit={finish}
                      />
                      <Field
                        label="Y"
                        value={position!.y}
                        onChange={(y) => patch({ y: layer.y + y - position!.y }, '', true)}
                        onCommit={finish}
                      />
                      <Field
                        label="Ш"
                        value={inkBounds!.width}
                        disabled={layer.kind === 'group'}
                        min={1}
                        onChange={(v) => setDimension('width', v)}
                        onCommit={finish}
                      />
                      <Field
                        label="В"
                        value={inkBounds!.height}
                        disabled={layer.kind === 'group'}
                        min={1}
                        onChange={(v) => setDimension('height', v)}
                        onCommit={finish}
                      />
                      <Field
                        label="∠"
                        value={layer.rotation}
                        disabled={layer.kind === 'group'}
                        min={-360}
                        max={360}
                        suffix="°"
                        onChange={(rotation) =>
                          patch(pointText ? rotateVisual(layer, rotation) : { rotation }, '', true)
                        }
                        onCommit={finish}
                      />
                      <div className="transform-buttons">
                        <IconButton
                          icon={FlipHorizontal2}
                          disabled={layer.kind === 'group'}
                          label="Отразить по горизонтали"
                          onClick={() => patch({ flipX: !layer.flipX }, 'Отражение по горизонтали')}
                        />
                        <IconButton
                          icon={FlipVertical2}
                          disabled={layer.kind === 'group'}
                          label="Отразить по вертикали"
                          onClick={() => patch({ flipY: !layer.flipY }, 'Отражение по вертикали')}
                        />
                        <IconButton
                          icon={RotateCcw}
                          disabled={layer.kind === 'group'}
                          label="Сбросить поворот"
                          onClick={() => patch({ rotation: 0 }, 'Сброс поворота')}
                        />
                      </div>
                    </div>
                    {layer.warp && (
                      <button
                        className="text-button"
                        style={{ marginTop: 10 }}
                        onClick={() => patch({ warp: undefined }, 'Сброс перспективы')}
                      >
                        Сбросить перспективу
                      </button>
                    )}
                  </div>
                  {pointText && (
                    <p className="panel-note text-geometry-note">
                      Размер — по глифам выбранного шрифта. X/Y — край выделения на холсте. Обычный
                      текст не переносится по ширине; для переноса используй текстовую рамку.
                    </p>
                  )}
                  <div className="property-section layer-structure">
                    <div className="section-heading">Структура слоя</div>
                    <Select
                      aria-label="Родительская группа"
                      value={layer.parentId || ''}
                      onChange={(e) => onParent(e.target.value || null)}
                    >
                      <option value="">Вне группы</option>
                      {doc.layers
                        .filter(
                          (l) =>
                            l.kind === 'group' &&
                            l.id !== layer.id &&
                            !descendants(doc, layer.id).has(l.id),
                        )
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </Select>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={!!layer.clipping}
                        onChange={(e) => patch({ clipping: e.target.checked }, 'Обтравочная маска')}
                      />
                      Обтравка по нижнему слою
                    </label>
                    {layer.kind === 'group' && (
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={!!layer.isolated}
                          onChange={(e) => patch({ isolated: e.target.checked }, 'Изоляция группы')}
                        />
                        Изолировать наложение группы
                      </label>
                    )}
                  </div>
                  {layer.kind === 'text' && (
                    <div className="property-section text-properties">
                      <div className="section-heading">
                        Свойства текста
                        <Type size={13} />
                      </div>
                      <textarea
                        aria-label="Текст слоя"
                        className="text-content-field"
                        value={layer.text || ''}
                        onChange={(e) =>
                          patch(
                            {
                              text: e.target.value,
                            },
                            '',
                            true,
                          )
                        }
                        onBlur={() => editor.finish('Редактирование текста')}
                        maxLength={20000}
                        rows={3}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault()
                            e.currentTarget.blur()
                          }
                        }}
                      />
                      <div className="font-select-row">
                        <Select
                          aria-label="Шрифт"
                          value={layer.fontFamily || 'Manrope'}
                          onChange={(e) => {
                            const fontFamily = e.target.value
                            void useFont(fontFamily).then(() => patch({ fontFamily }, 'Шрифт'))
                          }}
                        >
                          {[...new Set([layer.fontFamily || 'Manrope', ...fonts])].map((f) => (
                            <option key={f}>{f}</option>
                          ))}
                        </Select>
                        <button
                          className="compact-button"
                          onClick={onFonts}
                          title="Системные шрифты, TTF / OTF и Google Fonts"
                          aria-label="Библиотека шрифтов"
                        >
                          Aa+
                        </button>
                      </div>
                      {!fonts.includes(layer.fontFamily || 'Manrope') && (
                        <p className="panel-note">
                          Шрифт не подтверждён в библиотеке. Загрузи его через Aa+ или обнови список
                          шрифтов компьютера. Иначе при редактировании возможна замена.
                        </p>
                      )}
                      <div className="text-style-row">
                        <Field
                          label="Размер"
                          value={layer.fontSize || 48}
                          min={4}
                          max={1000}
                          onChange={(fontSize) => patch({ fontSize }, '', true)}
                          onCommit={finish}
                        />
                        <IconButton
                          icon={Bold}
                          label="Полужирный"
                          active={(layer.fontWeight || 500) >= 700}
                          onClick={() =>
                            patch(
                              { fontWeight: (layer.fontWeight || 500) >= 700 ? 400 : 700 },
                              'Начертание',
                            )
                          }
                        />
                        <IconButton
                          icon={Italic}
                          label="Курсив"
                          active={layer.italic}
                          onClick={() => patch({ italic: !layer.italic }, 'Начертание')}
                        />
                      </div>
                      <div className="text-style-row">
                        <div className="segmented-control">
                          {(
                            [
                              ['left', AlignLeft, 'По левому краю'],
                              ['center', AlignCenter, 'По центру'],
                              ['right', AlignRight, 'По правому краю'],
                            ] as const
                          ).map(([value, icon, label]) => (
                            <IconButton
                              key={value}
                              icon={icon}
                              label={label}
                              active={(layer.textAlign || 'left') === value}
                              onClick={() => patch({ textAlign: value }, 'Выравнивание текста')}
                            />
                          ))}
                        </div>
                        <Field
                          label="А↔"
                          value={layer.letterSpacing || 0}
                          min={-30}
                          max={100}
                          onChange={(letterSpacing) => patch({ letterSpacing }, '', true)}
                          onCommit={finish}
                        />
                      </div>
                      <Field
                        label="Интерлиньяж"
                        value={layer.lineHeight || 1.2}
                        min={0.5}
                        max={4}
                        step={0.1}
                        onChange={(lineHeight) => patch({ lineHeight }, '', true)}
                        onCommit={finish}
                      />
                      <TextFrameSettings layer={layer} patch={patch} finish={finish} />
                      <ColorField
                        label="Цвет текста"
                        value={layer.color}
                        onChange={(color) => patch({ color }, '', true)}
                        onCommit={finish}
                      />
                    </div>
                  )}
                  {layer.kind === 'shape' && (
                    <ShapeProperties key={layer.id} layer={layer} patch={patch} finish={finish} />
                  )}
                  {layer.kind === 'image' && !layer.smart && (
                    <div className="property-section quick-actions">
                      <div className="section-heading">
                        Быстрые действия
                        <Sparkles size={13} />
                      </div>
                      <button
                        className="action-button primary-action"
                        onClick={onRemoveBackground}
                        title="Локальное удаление связного фона по цветам углов изображения"
                      >
                        <Sparkles size={15} />
                        <strong>Удалить фон</strong>
                        <span className="local-tag">ЛОКАЛЬНО</span>
                      </button>
                      <div className="quick-action-row">
                        <button className="action-button" onClick={onFitLayer}>
                          <Maximize size={13} />
                          Подогнать
                        </button>
                        <button
                          className={`action-button ${layer.adjustments.grayscale ? 'active' : ''}`}
                          onClick={() =>
                            patch(
                              {
                                adjustments: {
                                  ...layer.adjustments,
                                  grayscale: layer.adjustments.grayscale ? 0 : 100,
                                },
                              },
                              'Чёрно-белый фильтр',
                            )
                          }
                        >
                          <span className="bw-icon" />
                          Чёрно-белое
                        </button>
                      </div>
                      <div className="tolerance-row">
                        <span title="Больше допуск — больше близких цветов будет удалено">
                          Допуск фона
                        </span>
                        <input
                          type="range"
                          aria-label="Допуск удаления фона"
                          min={1}
                          max={75}
                          value={settings.tolerance}
                          onChange={(e) => setSettings({ tolerance: +e.target.value })}
                        />
                        <span>{settings.tolerance}%</span>
                      </div>
                    </div>
                  )}
                  <div className="property-section adjustment-section">
                    <button
                      className="section-heading section-toggle"
                      onClick={() => setAdjustOpen(!adjustOpen)}
                    >
                      <span>
                        <SlidersHorizontal size={13} />
                        Цветокоррекция
                      </span>
                      {adjustOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    {adjustOpen && (
                      <div className="adjustment-sliders">
                        <Slider
                          label="Яркость"
                          value={layer.adjustments.brightness}
                          min={-100}
                          onChange={(v) => adjust('brightness', v)}
                          onCommit={finish}
                        />
                        <Slider
                          label="Контраст"
                          value={layer.adjustments.contrast}
                          min={-100}
                          onChange={(v) => adjust('contrast', v)}
                          onCommit={finish}
                        />
                        <Slider
                          label="Насыщенность"
                          value={layer.adjustments.saturation}
                          min={-100}
                          onChange={(v) => adjust('saturation', v)}
                          onCommit={finish}
                        />
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="property-section">
                    <div className="section-heading">
                      Другое настроение
                      <button
                        className="text-button"
                        onClick={() =>
                          patch({ adjustments: { ...DEFAULT_ADJUSTMENTS } }, 'Сброс эффектов')
                        }
                      >
                        Сбросить
                      </button>
                    </div>
                    <div className="preset-grid">
                      {presets.map((p) => (
                        <button
                          key={p.name}
                          className={`preset-card ${JSON.stringify(layer.adjustments) === JSON.stringify({ ...DEFAULT_ADJUSTMENTS, ...p.values }) ? 'selected' : ''}`}
                          onClick={() =>
                            patch(
                              { adjustments: { ...DEFAULT_ADJUSTMENTS, ...p.values } },
                              `Эффект: ${p.name}`,
                            )
                          }
                        >
                          <img
                            src={layer.src || '/demo-landscape.webp'}
                            alt=""
                            style={{ filter: p.filter }}
                          />
                          <span>{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="property-section effect-sliders">
                    <div className="section-heading">
                      Точная настройка
                      <SlidersHorizontal size={13} />
                    </div>
                    <Slider
                      label="Яркость"
                      value={layer.adjustments.brightness}
                      min={-100}
                      onChange={(v) => adjust('brightness', v)}
                      onCommit={finish}
                    />
                    <Slider
                      label="Контраст"
                      value={layer.adjustments.contrast}
                      min={-100}
                      onChange={(v) => adjust('contrast', v)}
                      onCommit={finish}
                    />
                    <Slider
                      label="Насыщенность"
                      value={layer.adjustments.saturation}
                      min={-100}
                      onChange={(v) => adjust('saturation', v)}
                      onCommit={finish}
                    />
                    <Slider
                      label="Цветовой тон"
                      value={layer.adjustments.hue}
                      min={-180}
                      max={180}
                      suffix="°"
                      onChange={(v) => adjust('hue', v)}
                      onCommit={finish}
                    />
                    <Slider
                      label="Размытие"
                      value={layer.adjustments.blur}
                      max={30}
                      suffix=" px"
                      onChange={(v) => adjust('blur', v)}
                      onCommit={finish}
                    />
                  </div>
                </>
              )}
            </fieldset>
          </>
        )}
      </div>
    </section>
  )
}
