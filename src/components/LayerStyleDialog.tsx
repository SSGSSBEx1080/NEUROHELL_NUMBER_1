import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Download,
  Paintbrush,
  Plus,
  RotateCcw,
  Save,
  Scaling,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  MAX_STYLE_INSTANCES,
  type BlendIfChannelKey,
  type BlendIfQuad,
  type BlendIfRanges,
  type Layer,
  type LayerStyles,
} from '../types'
import {
  BLEND_IF_CHANNELS,
  blendIfChannelNames,
  defaultBlendIf,
  isBlendIfActive,
  parseBlendIf,
} from '../engine/blendIf'
import {
  STYLE_LIMITS,
  defaultGradientOverlayGradient,
  defaultGradientOverlayStyle,
  defaultInnerShadowStyle,
  defaultOverlayStyle,
  defaultShadowStyle,
  defaultStrokeStyle,
  defaultStyles,
  normalizeStyles,
  scaleLayerStyles,
} from '../engine/styles'
import { gradientCss } from '../engine/gradientRamp'
import {
  builtinStylePresets,
  copyStyleToClipboard,
  loadStyleLibrary,
  parseStyleLibraryFile,
  readStyleClipboard,
  readStyleClipboardBlendIf,
  saveStyleLibrary,
  serializeStyleLibrary,
  type StylePreset,
} from '../engine/libraries'
import { downloadBlob, loadImage, renderLayer } from '../engine/render'
import { GradientDefinitionEditor } from './GradientDefinitionEditor'
import { ColorField, Field, Modal, Select, Slider } from './ui'

type ListKey = 'strokes' | 'shadows' | 'innerShadows' | 'overlays' | 'gradients'
type Tab = ListKey | 'glow' | 'innerGlow' | 'blendIf' | 'library'
const sections: { id: Tab; name: string; note: string }[] = [
  {
    id: 'strokes',
    name: 'Обводка',
    note: 'Несколько обводок: верхняя строка списка — поверх остальных.',
  },
  { id: 'shadows', name: 'Тень', note: 'Отдельные тени со своим цветом, сдвигом и прозрачностью.' },
  { id: 'innerShadows', name: 'Внутренняя тень', note: 'Тень от края внутрь формы.' },
  { id: 'glow', name: 'Внешнее свечение', note: 'Свет вокруг формы.' },
  { id: 'innerGlow', name: 'Внутреннее свечение', note: 'Свет от края внутрь.' },
  {
    id: 'overlays',
    name: 'Наложение цвета',
    note: 'Цвет поверх содержимого, без изменения пикселей.',
  },
  {
    id: 'gradients',
    name: 'Градиент',
    note: 'Полные градиенты: цвет, прозрачность, середины и шум.',
  },
  {
    id: 'blendIf',
    name: 'Параметры наложения',
    note: 'Blend If: показывать пиксели по яркости/каналам этого и нижнего слоя. Разделённые пороги дают плавный переход.',
  },
  {
    id: 'library',
    name: 'Библиотека стилей',
    note: 'Пресеты, копирование между слоями и масштаб эффектов.',
  },
]
const enabledOf = (styles: LayerStyles, tab: Tab, blendIf?: BlendIfRanges): number => {
  if (tab === 'glow') return styles.glow.enabled ? 1 : 0
  if (tab === 'innerGlow') return styles.innerGlow.enabled ? 1 : 0
  if (tab === 'library') return 0
  if (tab === 'blendIf') return isBlendIfActive(blendIf) ? 1 : 0
  return styles[tab].filter((e) => e.enabled).length
}

export function LayerStyleDialog({
  layer,
  onClose,
  onApply,
}: {
  layer: Layer
  onClose: () => void
  onApply: (styles: LayerStyles, blendIf: BlendIfRanges | undefined) => void
}) {
  const [styles, setStyles] = useState<LayerStyles>(() =>
    structuredClone(normalizeStyles(layer.styles) || defaultStyles()),
  )
  const [blendIf, setBlendIf] = useState<BlendIfRanges>(
    () => parseBlendIf(layer.blendIf) || defaultBlendIf(),
  )
  const [blendChannel, setBlendChannel] = useState<BlendIfChannelKey>('gray')
  const patchQuad = (side: 'source' | 'under', index: number, value: number) =>
    setBlendIf((current) => {
      const quad = [...current[blendChannel][side]] as BlendIfQuad
      quad[index] = Math.min(255, Math.max(0, Math.round(value)))
      // Keep each split pair ordered, like dragging a split slider triangle.
      if (index === 0 && quad[1] < quad[0]) quad[1] = quad[0]
      if (index === 1 && quad[0] > quad[1]) quad[0] = quad[1]
      if (index === 2 && quad[3] < quad[2]) quad[3] = quad[2]
      if (index === 3 && quad[2] > quad[3]) quad[2] = quad[3]
      return { ...current, [blendChannel]: { ...current[blendChannel], [side]: quad } }
    })
  const [tab, setTab] = useState<Tab>('strokes')
  const [selected, setSelected] = useState(0)
  const [presetName, setPresetName] = useState('')
  const [scalePercent, setScalePercent] = useState(100)
  const [library, setLibrary] = useState<StylePreset[]>(() => loadStyleLibrary())
  const [message, setMessage] = useState('')
  const preview = useRef<HTMLCanvasElement>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      if (layer.src) await loadImage(layer.src)
      if (cancelled || !preview.current) return
      const canvas = preview.current,
        ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, 600, 350)
      const scale = Math.min(420 / layer.width, 210 / layer.height, 1.8)
      ctx.save()
      ctx.translate((600 - layer.width * scale) / 2, (350 - layer.height * scale) / 2)
      ctx.scale(scale, scale)
      renderLayer(ctx, {
        ...layer,
        id: `${layer.id}-style-preview`,
        x: 0,
        y: 0,
        rotation: 0,
        visible: true,
        styles,
        opacity: 1,
        blendMode: 'source-over',
      })
      ctx.restore()
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [layer, styles])

  const chooseTab = (next: Tab) => {
    setTab(next)
    setSelected(0)
    setMessage('')
  }
  const listKey: ListKey | undefined =
    tab !== 'glow' && tab !== 'innerGlow' && tab !== 'library' && tab !== 'blendIf'
      ? tab
      : undefined
  const items = listKey ? styles[listKey] : []
  const index = Math.min(selected, Math.max(0, items.length - 1))
  const patchItem = (patch: object) => {
    if (!listKey) return
    setStyles((s) => ({
      ...s,
      [listKey]: s[listKey].map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }
  const patchSingle = (key: 'glow' | 'innerGlow', patch: object) =>
    setStyles((s) => ({ ...s, [key]: { ...s[key], ...patch } }))
  const factories = {
    strokes: defaultStrokeStyle,
    shadows: defaultShadowStyle,
    innerShadows: defaultInnerShadowStyle,
    overlays: defaultOverlayStyle,
    gradients: defaultGradientOverlayStyle,
  } as const
  const addItem = () => {
    if (!listKey || items.length >= MAX_STYLE_INSTANCES) return
    const copy = structuredClone(items[index] || factories[listKey]()) as { enabled: boolean }
    copy.enabled = true
    setStyles((s) => ({
      ...s,
      [listKey]: [
        ...s[listKey].slice(0, index + 1),
        copy,
        ...s[listKey].slice(index + 1),
      ] as LayerStyles[ListKey],
    }))
    setSelected(index + 1)
  }
  const removeItem = () => {
    if (!listKey) return
    if (items.length <= 1) {
      setStyles((s) => ({ ...s, [listKey]: [factories[listKey]()] }))
      setSelected(0)
      return
    }
    setStyles((s) => ({ ...s, [listKey]: s[listKey].filter((_, i) => i !== index) }))
    setSelected(Math.max(0, index - 1))
  }
  const moveItem = (direction: -1 | 1) => {
    if (!listKey) return
    const target = index + direction
    if (target < 0 || target >= items.length) return
    setStyles((s) => {
      const next = [...s[listKey]]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...s, [listKey]: next }
    })
    setSelected(target)
  }
  const itemLabel = (i: number): string => {
    if (listKey === 'strokes') {
      const e = styles.strokes[i]
      return `${e.size} px · ${e.position === 'outside' ? 'снаружи' : e.position === 'center' ? 'по центру' : 'внутри'} · ${e.fill === 'gradient' ? e.gradient?.name || 'Градиент' : e.color}`
    }
    if (listKey === 'shadows' || listKey === 'innerShadows') {
      const e = styles[listKey][i]
      return `${e.x}, ${e.y} · ${e.blur} px · ${e.color}`
    }
    if (listKey === 'overlays') return styles.overlays[i].color
    if (listKey === 'gradients') return styles.gradients[i].gradient.name || 'Градиент'
    return ''
  }
  const activeEnabled =
    tab === 'glow'
      ? styles.glow.enabled
      : tab === 'innerGlow'
        ? styles.innerGlow.enabled
        : listKey
          ? !!items[index]?.enabled
          : false
  const setActiveEnabled = (enabled: boolean) => {
    if (tab === 'glow' || tab === 'innerGlow') patchSingle(tab, { enabled })
    else patchItem({ enabled })
  }
  const applyPreset = (preset: StylePreset) => {
    setStyles(structuredClone(preset.styles))
    setSelected(0)
    setMessage(`Применён стиль «${preset.name}» — нажми «Применить стиль», чтобы сохранить в слое.`)
  }
  const stroke = styles.strokes[index] || defaultStrokeStyle()
  const shadow =
    (listKey === 'innerShadows' ? styles.innerShadows[index] : styles.shadows[index]) ||
    defaultShadowStyle()
  const overlay = styles.overlays[index] || defaultOverlayStyle()
  const gradientItem = styles.gradients[index] || defaultGradientOverlayStyle()

  return (
    <Modal
      title="Характер — в деталях"
      subtitle={`Стиль слоя · ${layer.name}`}
      onClose={onClose}
      wide
    >
      <div className="style-layout">
        <nav className="style-navigation">
          {sections.map((s) => {
            const count = enabledOf(styles, s.id, blendIf)
            return (
              <button
                key={s.id}
                className={tab === s.id ? 'selected' : ''}
                onClick={() => chooseTab(s.id)}
              >
                <span className={`effect-check ${count ? 'on' : ''}`}>
                  {count > 0 && <Check size={10} />}
                </span>
                {s.name}
                {count > 1 && <span className="effect-count">×{count}</span>}
              </button>
            )
          })}
          <div className="style-fill">
            <Slider
              label="Заливка слоя (Fill)"
              value={styles.fillOpacity * 100}
              onChange={(v) => setStyles((s) => ({ ...s, fillOpacity: v / 100 }))}
              suffix="%"
            />
            <p className="panel-note">
              Заливка ослабляет содержимое, но не обводки, тени и свечение.
            </p>
          </div>
        </nav>
        <div className="style-controls">
          <div className="style-title">
            <span>
              <Paintbrush size={16} />
              {sections.find((s) => s.id === tab)!.name}
            </span>
            {tab !== 'library' && tab !== 'blendIf' && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  aria-label="Включить эффект"
                  checked={activeEnabled}
                  onChange={(e) => setActiveEnabled(e.target.checked)}
                />
                Включить
              </label>
            )}
          </div>
          <p className="panel-note">{sections.find((s) => s.id === tab)!.note}</p>

          {listKey && (
            <div className="effect-instance-list" data-testid="effect-instance-list">
              {items.map((item, i) => (
                <div key={i} className={`effect-instance ${i === index ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Включить экземпляр ${i + 1}`}
                    checked={item.enabled}
                    onChange={(e) =>
                      setStyles((s) => ({
                        ...s,
                        [listKey]: s[listKey].map((old, j) =>
                          j === i ? { ...old, enabled: e.target.checked } : old,
                        ),
                      }))
                    }
                  />
                  <button className="effect-instance-name" onClick={() => setSelected(i)}>
                    #{i + 1} · {itemLabel(i)}
                  </button>
                </div>
              ))}
              <div className="effect-instance-tools">
                <button
                  className="compact-button"
                  aria-label="Добавить экземпляр эффекта"
                  disabled={items.length >= MAX_STYLE_INSTANCES}
                  onClick={addItem}
                >
                  <Plus size={13} /> Добавить
                </button>
                <button
                  className="compact-button"
                  aria-label="Выше в порядке"
                  disabled={index === 0}
                  onClick={() => moveItem(-1)}
                >
                  <ChevronUp size={13} /> Выше
                </button>
                <button
                  className="compact-button"
                  aria-label="Ниже в порядке"
                  disabled={index >= items.length - 1}
                  onClick={() => moveItem(1)}
                >
                  <ChevronDown size={13} /> Ниже
                </button>
                <button
                  className="compact-button"
                  aria-label="Удалить экземпляр эффекта"
                  onClick={removeItem}
                >
                  <Trash2 size={13} /> Удалить
                </button>
              </div>
            </div>
          )}

          {tab === 'strokes' && (
            <>
              <Slider
                label="Размер обводки"
                value={stroke.size}
                max={STYLE_LIMITS.strokeSize}
                suffix=" px"
                onChange={(size) => patchItem({ size, enabled: true })}
              />
              <Select
                aria-label="Положение обводки"
                value={stroke.position}
                onChange={(e) => patchItem({ position: e.target.value })}
              >
                <option value="outside">Снаружи</option>
                <option value="center">По центру</option>
                <option value="inside">Внутри</option>
              </Select>
              <Select
                aria-label="Тип заливки обводки"
                value={stroke.fill}
                onChange={(e) =>
                  patchItem({
                    fill: e.target.value,
                    enabled: true,
                    ...(e.target.value === 'gradient' && !stroke.gradient
                      ? { gradient: defaultGradientOverlayGradient() }
                      : {}),
                  })
                }
              >
                <option value="color">Цвет</option>
                <option value="gradient">Градиент</option>
              </Select>
              {stroke.fill === 'color' ? (
                <ColorField
                  label="Цвет обводки слоя"
                  value={stroke.color}
                  onChange={(color) => patchItem({ color, enabled: true })}
                />
              ) : (
                <>
                  {stroke.gradient && (
                    <GradientDefinitionEditor
                      definition={stroke.gradient}
                      onChange={(gradient) => patchItem({ gradient, enabled: true })}
                      onFinish={() => {}}
                    />
                  )}
                  <Select
                    aria-label="Стиль градиента обводки"
                    value={stroke.gradientShape}
                    onChange={(e) => patchItem({ gradientShape: e.target.value, enabled: true })}
                  >
                    <option value="linear">Линейный</option>
                    <option value="radial">Радиальный</option>
                    <option value="reflected">Отражённый</option>
                    <option value="angle">Угловой</option>
                    <option value="diamond">Ромб</option>
                  </Select>
                  <Slider
                    label="Угол градиента обводки"
                    value={stroke.gradientAngle}
                    max={360}
                    suffix="°"
                    onChange={(gradientAngle) => patchItem({ gradientAngle, enabled: true })}
                  />
                  <Slider
                    label="Масштаб градиента обводки"
                    value={stroke.gradientScale * 100}
                    min={10}
                    max={400}
                    suffix="%"
                    onChange={(v) => patchItem({ gradientScale: v / 100, enabled: true })}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={stroke.gradientReverse}
                      onChange={(e) =>
                        patchItem({ gradientReverse: e.target.checked, enabled: true })
                      }
                    />
                    Обратить градиент обводки
                  </label>
                </>
              )}
              <Slider
                label="Непрозрачность обводки"
                value={stroke.opacity * 100}
                suffix="%"
                onChange={(v) => patchItem({ opacity: v / 100, enabled: true })}
              />
            </>
          )}
          {(tab === 'shadows' || tab === 'innerShadows') && (
            <>
              <ColorField
                label="Цвет тени"
                value={shadow.color}
                onChange={(color) => patchItem({ color, enabled: true })}
              />
              <Slider
                label="Размытие тени"
                value={shadow.blur}
                max={STYLE_LIMITS.blur}
                suffix=" px"
                onChange={(blur) => patchItem({ blur, enabled: true })}
              />
              <div className="field-grid">
                <Field
                  label="Сдвиг X"
                  value={shadow.x}
                  min={-STYLE_LIMITS.offset}
                  max={STYLE_LIMITS.offset}
                  onChange={(x) => patchItem({ x, enabled: true })}
                />
                <Field
                  label="Сдвиг Y"
                  value={shadow.y}
                  min={-STYLE_LIMITS.offset}
                  max={STYLE_LIMITS.offset}
                  onChange={(y) => patchItem({ y, enabled: true })}
                />
              </div>
              <Slider
                label="Непрозрачность тени"
                value={shadow.opacity * 100}
                suffix="%"
                onChange={(v) => patchItem({ opacity: v / 100 })}
              />
            </>
          )}
          {(tab === 'glow' || tab === 'innerGlow') && (
            <>
              <ColorField
                label="Цвет свечения"
                value={styles[tab].color}
                onChange={(color) => patchSingle(tab, { color, enabled: true })}
              />
              <Slider
                label="Радиус свечения"
                value={styles[tab].blur}
                max={STYLE_LIMITS.blur}
                suffix=" px"
                onChange={(blur) => patchSingle(tab, { blur, enabled: true })}
              />
              <Slider
                label="Непрозрачность свечения"
                value={styles[tab].opacity * 100}
                suffix="%"
                onChange={(v) => patchSingle(tab, { opacity: v / 100 })}
              />
            </>
          )}
          {tab === 'overlays' && (
            <>
              <ColorField
                label="Цвет наложения"
                value={overlay.color}
                onChange={(color) => patchItem({ color, enabled: true })}
              />
              <Slider
                label="Непрозрачность цвета"
                value={overlay.opacity * 100}
                suffix="%"
                onChange={(v) => patchItem({ opacity: v / 100, enabled: true })}
              />
            </>
          )}
          {tab === 'gradients' && (
            <>
              <div
                className="gradient-strip"
                style={{ background: gradientCss(gradientItem.gradient, gradientItem.angle, 32) }}
              />
              <GradientDefinitionEditor
                definition={gradientItem.gradient}
                onChange={(gradient) => patchItem({ gradient, enabled: true })}
                onFinish={() => {}}
              />
              <Select
                aria-label="Стиль градиента наложения"
                value={gradientItem.shape}
                onChange={(e) => patchItem({ shape: e.target.value, enabled: true })}
              >
                <option value="linear">Линейный</option>
                <option value="radial">Радиальный</option>
                <option value="reflected">Отражённый</option>
                <option value="angle">Угловой</option>
                <option value="diamond">Ромб</option>
              </Select>
              <Slider
                label="Масштаб градиента"
                value={gradientItem.scale * 100}
                min={10}
                max={400}
                suffix="%"
                onChange={(v) => patchItem({ scale: v / 100, enabled: true })}
              />
              <Slider
                label="Угол градиента"
                value={gradientItem.angle}
                max={360}
                suffix="°"
                onChange={(angle) => patchItem({ angle, enabled: true })}
              />
              <Slider
                label="Непрозрачность градиента"
                value={gradientItem.opacity * 100}
                suffix="%"
                onChange={(v) => patchItem({ opacity: v / 100 })}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={gradientItem.reverse}
                  onChange={(e) => patchItem({ reverse: e.target.checked, enabled: true })}
                />
                Обратить градиент
              </label>
            </>
          )}
          {tab === 'blendIf' && (
            <div data-testid="blend-if-controls">
              <Select
                aria-label="Канал Blend If"
                value={blendChannel}
                onChange={(e) => setBlendChannel(e.target.value as BlendIfChannelKey)}
              >
                {BLEND_IF_CHANNELS.map((key) => (
                  <option value={key} key={key}>
                    {blendIfChannelNames[key]}
                  </option>
                ))}
              </Select>
              {(
                [
                  ['source', 'Этот слой'],
                  ['under', 'Нижний слой'],
                ] as const
              ).map(([side, title]) => {
                const quad = blendIf[blendChannel][side]
                const labels = [
                  'Тени: скрывать ниже',
                  'Тени: переход до',
                  'Света: переход от',
                  'Света: скрывать выше',
                ]
                return (
                  <div key={side}>
                    <span className="panel-subtitle">{title}</span>
                    {labels.map((label, i) => (
                      <Slider
                        key={label}
                        label={`${title} — ${label}`}
                        value={quad[i]}
                        min={0}
                        max={255}
                        suffix=""
                        onChange={(v) => patchQuad(side, i, v)}
                      />
                    ))}
                  </div>
                )
              })}
              <div className="effect-instance-tools">
                <button
                  className="compact-button"
                  onClick={() =>
                    setBlendIf((current) => ({
                      ...current,
                      [blendChannel]: {
                        source: [0, 0, 255, 255] as BlendIfQuad,
                        under: [0, 0, 255, 255] as BlendIfQuad,
                      },
                    }))
                  }
                >
                  <RotateCcw size={13} /> Сбросить канал
                </button>
                <button className="compact-button" onClick={() => setBlendIf(defaultBlendIf())}>
                  <RotateCcw size={13} /> Сбросить всё
                </button>
              </div>
              <p className="panel-note">
                {layer.kind === 'adjustment'
                  ? 'У корректирующего слоя нет своих пикселей: работает только диапазон «Нижний слой» — как маска силы коррекции.'
                  : 'Результат виден на холсте документа после «Применить стиль»: предпросмотр ниже показывает один слой без подложки.'}
              </p>
            </div>
          )}
          {tab === 'library' && (
            <div data-testid="style-library">
              <span className="panel-subtitle">Готовые стили</span>
              <div className="path-button-grid">
                {builtinStylePresets.map((preset) => (
                  <button
                    key={preset.name}
                    className="compact-button"
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <span className="panel-subtitle">Мои стили ({library.length})</span>
              <div className="path-button-grid">
                {library.map((preset) => (
                  <button
                    key={preset.name}
                    className="compact-button"
                    onClick={() => applyPreset(preset)}
                  >
                    ★ {preset.name}
                  </button>
                ))}
                {!library.length && (
                  <span className="panel-note">Пока пусто — сохрани текущий стиль ниже.</span>
                )}
              </div>
              <label className="dialog-label">
                Название нового стиля
                <input
                  className="dialog-input"
                  aria-label="Название нового стиля"
                  value={presetName}
                  maxLength={80}
                  placeholder="Например: Заголовок ULTRA"
                  onChange={(e) => setPresetName(e.target.value)}
                />
              </label>
              <div className="path-button-grid">
                <button
                  className="compact-button"
                  disabled={!presetName.trim()}
                  onClick={() => {
                    const preset = { name: presetName.trim(), styles: structuredClone(styles) }
                    const next = [...library.filter((p) => p.name !== preset.name), preset].slice(
                      -64,
                    )
                    setLibrary(next)
                    saveStyleLibrary(next)
                    setPresetName('')
                    setMessage(`Стиль «${preset.name}» сохранён в библиотеку.`)
                  }}
                >
                  <Save size={13} /> Сохранить стиль
                </button>
                <button
                  className="compact-button"
                  disabled={
                    !presetName.trim() || !library.some((p) => p.name === presetName.trim())
                  }
                  onClick={() => {
                    const next = library.filter((p) => p.name !== presetName.trim())
                    setLibrary(next)
                    saveStyleLibrary(next)
                    setMessage('Стиль удалён из библиотеки.')
                  }}
                >
                  <Trash2 size={13} /> Удалить по названию
                </button>
                <button className="compact-button" onClick={() => file.current?.click()}>
                  <Upload size={13} /> Импорт стилей
                </button>
                <button
                  className="compact-button"
                  disabled={!library.length}
                  onClick={() =>
                    void downloadBlob(
                      new Blob([serializeStyleLibrary(library)], { type: 'application/json' }),
                      'styles.777styles.json',
                    ).catch((e) => setMessage(e instanceof Error ? e.message : 'Ошибка экспорта'))
                  }
                >
                  <Download size={13} /> Экспорт стилей
                </button>
              </div>
              <span className="panel-subtitle">Между слоями</span>
              <div className="path-button-grid">
                <button
                  className="compact-button"
                  onClick={() => {
                    copyStyleToClipboard(styles, parseBlendIf(blendIf))
                    setMessage('Стиль скопирован. Открой стили другого слоя и вставь.')
                  }}
                >
                  <ClipboardCopy size={13} /> Копировать стиль
                </button>
                <button
                  className="compact-button"
                  onClick={() => {
                    const pasted = readStyleClipboard()
                    if (pasted) {
                      setStyles(pasted)
                      setBlendIf(readStyleClipboardBlendIf() || defaultBlendIf())
                      setSelected(0)
                      setMessage('Стиль вставлен в предпросмотр.')
                    } else setMessage('Буфер стилей пуст.')
                  }}
                >
                  <ClipboardPaste size={13} /> Вставить стиль
                </button>
              </div>
              <span className="panel-subtitle">Масштаб эффектов</span>
              <div className="field-grid">
                <Field
                  label="Масштаб"
                  value={scalePercent}
                  min={5}
                  max={400}
                  suffix="%"
                  onChange={setScalePercent}
                />
                <button
                  className="compact-button"
                  onClick={() => setStyles((s) => scaleLayerStyles(s, scalePercent / 100))}
                >
                  <Scaling size={13} /> Масштабировать размеры и сдвиги
                </button>
              </div>
              <input
                ref={file}
                type="file"
                accept="application/json,.json"
                hidden
                aria-label="Импорт библиотеки стилей"
                onChange={(e) => {
                  const picked = e.target.files?.[0]
                  e.target.value = ''
                  if (!picked) return
                  void picked
                    .text()
                    .then((text) => {
                      const imported = parseStyleLibraryFile(text)
                      const names = new Set(imported.map((p) => p.name))
                      const next = [
                        ...library.filter((p) => !names.has(p.name)),
                        ...imported,
                      ].slice(-64)
                      setLibrary(next)
                      saveStyleLibrary(next)
                      setMessage(`Импортировано стилей: ${imported.length}.`)
                    })
                    .catch((err: unknown) =>
                      setMessage(err instanceof Error ? err.message : 'Ошибка импорта стилей'),
                    )
                }}
              />
            </div>
          )}
          {message && <p className="panel-note">{message}</p>}
        </div>
      </div>
      <div className="style-preview">
        <canvas ref={preview} width={600} height={350} />
        <span>Живой предпросмотр · изменения применятся по кнопке</span>
      </div>
      <footer className="dialog-footer">
        <button className="text-button" onClick={() => setStyles(defaultStyles())}>
          <RotateCcw size={14} />
          Сбросить стили
        </button>
        <button
          className="text-button"
          onClick={() => {
            copyStyleToClipboard(styles, parseBlendIf(blendIf))
            setMessage('Стиль скопирован.')
          }}
        >
          <Copy size={14} />
          Копировать
        </button>
        <button
          className="primary-button"
          onClick={() => onApply(normalizeStyles(styles) || styles, parseBlendIf(blendIf))}
        >
          <Sparkles size={15} />
          Применить стиль
        </button>
      </footer>
    </Modal>
  )
}
