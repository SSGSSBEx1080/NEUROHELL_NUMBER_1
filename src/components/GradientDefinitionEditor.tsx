import { useMemo, useRef, useState } from 'react'
import { Dices, Download, Save, Trash2, Upload } from 'lucide-react'
import {
  GRADIENT_QUANTUM,
  MAX_GRADIENT_OPACITY_STOPS,
  defaultNoiseSpec,
  gradientCss,
  gradientDefinitionPresets,
  gradientOpacityAt,
  parseGradientDefinition,
  parseGradientOpacityStops,
  type GradientColorModel,
  type GradientDefinition,
  type GradientOpacityStop,
} from '../engine/gradientRamp'
import {
  loadGradientLibrary,
  parseGradientLibraryFile,
  saveGradientLibrary,
  serializeGradientLibrary,
} from '../engine/libraries'
import { downloadBlob } from '../engine/render'
import { GradientEditor } from './GradientEditor'
import { Field, Select, Slider } from './ui'

const channelLabels: Record<GradientColorModel, string[]> = {
  rgb: ['Красный', 'Зелёный', 'Синий'],
  hsb: ['Тон', 'Насыщенность', 'Яркость'],
  lab: ['Светлота L', 'Ось a', 'Ось b'],
}

function OpacityStopsEditor({
  stops,
  onChange,
  onFinish,
}: {
  stops: GradientOpacityStop[]
  onChange: (stops: GradientOpacityStop[]) => void
  onFinish: () => void
}) {
  const [selected, setSelected] = useState(0),
    [error, setError] = useState(''),
    bar = useRef<HTMLDivElement>(null),
    drag = useRef<number | undefined>(undefined)
  const index = Math.min(selected, stops.length - 1),
    stop = stops[index]
  const set = (values: GradientOpacityStop[]) => {
    try {
      onChange(parseGradientOpacityStops(values))
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка прозрачности градиента')
    }
  }
  const place = (position: number, at = index) => {
    const lo = at ? stops[at - 1].position + GRADIENT_QUANTUM : 0,
      hi = at < stops.length - 1 ? stops[at + 1].position - GRADIENT_QUANTUM : 1
    set(
      stops.map((s, i) =>
        i === at ? { ...s, position: Math.max(lo, Math.min(hi, position)) } : s,
      ),
    )
  }
  return (
    <div className="gradient-editor" data-testid="opacity-stops-editor">
      <span className="panel-subtitle">Прозрачность</span>
      <div
        ref={bar}
        className="gradient-ramp alpha-ramp"
        data-testid="opacity-ramp"
        style={{
          backgroundImage: `linear-gradient(90deg,${stops
            .map((s) => `rgba(32,32,38,${s.opacity}) ${s.position * 100}%`)
            .join(',')})`,
        }}
        onDoubleClick={(e) => {
          if ((e.target as Element).closest('button') || stops.length >= MAX_GRADIENT_OPACITY_STOPS)
            return
          const b = e.currentTarget.getBoundingClientRect(),
            p = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width))
          if (stops.some((s) => Math.abs(s.position - p) < GRADIENT_QUANTUM)) return
          const next = parseGradientOpacityStops([
            ...stops,
            { position: p, opacity: gradientOpacityAt(stops, p) },
          ])
          set(next)
          setSelected(next.findIndex((s) => s.position === Math.round(p * 4096) / 4096))
          onFinish()
        }}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            className={`gradient-stop ${i === index ? 'selected' : ''}`}
            aria-label={`Точка прозрачности ${i + 1}`}
            aria-pressed={i === index}
            style={
              {
                left: `${s.position * 100}%`,
                '--stop-color': `rgba(255,255,255,${0.25 + s.opacity * 0.75})`,
              } as React.CSSProperties
            }
            onClick={() => setSelected(i)}
            onFocus={() => setSelected(i)}
            onPointerDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setSelected(i)
              drag.current = i
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (drag.current === undefined || !e.currentTarget.hasPointerCapture(e.pointerId))
                return
              const b = bar.current!.getBoundingClientRect()
              place((e.clientX - b.left) / b.width, drag.current)
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId)
              drag.current = undefined
              onFinish()
            }}
            onPointerCancel={() => {
              drag.current = undefined
              onFinish()
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                place(
                  s.position +
                    (e.key === 'ArrowLeft' ? -1 : 1) * GRADIENT_QUANTUM * (e.shiftKey ? 10 : 1),
                  i,
                )
              }
            }}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow')) onFinish()
            }}
          >
            <span />
          </button>
        ))}
      </div>
      <div className="gradient-stop-fields">
        <Slider
          label="Непрозрачность точки"
          value={stop.opacity * 100}
          suffix="%"
          onChange={(v) => set(stops.map((s, i) => (i === index ? { ...s, opacity: v / 100 } : s)))}
          onCommit={onFinish}
        />
        <Field
          label="Позиция точки прозрачности"
          value={stop.position * 100}
          min={0}
          max={100}
          suffix="%"
          step={0.1}
          onChange={(v) => place(v / 100)}
          onCommit={onFinish}
        />
        {index < stops.length - 1 && (
          <Slider
            label="Середина прозрачности"
            value={(stop.midpoint ?? 0.5) * 100}
            suffix="%"
            onChange={(v) =>
              set(stops.map((s, i) => (i === index ? { ...s, midpoint: v / 100 } : s)))
            }
            onCommit={onFinish}
          />
        )}
      </div>
      <div className="path-button-grid">
        <button
          className="compact-button"
          disabled={stops.length >= MAX_GRADIENT_OPACITY_STOPS}
          onClick={() => {
            let p = 0.5,
              width = -1
            for (let i = 0; i < stops.length - 1; i++) {
              const w = stops[i + 1].position - stops[i].position
              if (w > width) {
                width = w
                p = (stops[i].position + stops[i + 1].position) / 2
              }
            }
            set([...stops, { position: p, opacity: gradientOpacityAt(stops, p) }])
            onFinish()
          }}
        >
          Добавить точку прозрачности
        </button>
        <button
          className="compact-button"
          disabled={stops.length <= 2}
          onClick={() => {
            set(stops.filter((_, i) => i !== index))
            setSelected(Math.max(0, index - 1))
            onFinish()
          }}
        >
          Удалить точку прозрачности
        </button>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Full gradient editor shared by the gradient tool and gradient overlays:
 * color stops, independent opacity stops, midpoints, seeded noise and a local library.
 */
export function GradientDefinitionEditor({
  definition,
  onChange,
  onFinish,
}: {
  definition: GradientDefinition
  onChange: (definition: GradientDefinition, temporary: boolean) => void
  onFinish: () => void
}) {
  const [library, setLibrary] = useState<GradientDefinition[]>(() => loadGradientLibrary()),
    [error, setError] = useState(''),
    file = useRef<HTMLInputElement>(null)
  const set = (next: GradientDefinition, temporary = true) => {
    try {
      onChange(parseGradientDefinition(next), temporary)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка градиента')
    }
  }
  const noise = definition.noise || defaultNoiseSpec()
  const patchNoise = (patch: Partial<typeof noise>) =>
    set({ ...definition, kind: 'noise', noise: { ...noise, ...patch } })
  const allPresets = [...gradientDefinitionPresets, ...library]
  // Recomputed only when the definition object itself changes, not on unrelated parent renders.
  const previewCss = useMemo(() => gradientCss(definition, 90, 48), [definition])
  return (
    <div data-testid="gradient-definition-editor">
      <div
        className="gradient-preview-strip"
        data-testid="gradient-preview-strip"
        style={{ backgroundImage: previewCss }}
      />
      <div className="field-grid">
        <Select
          aria-label="Библиотека градиентов"
          value=""
          onChange={(e) => {
            const index = +e.target.value,
              picked = allPresets[index]
            if (picked) set(structuredClone(picked), false)
          }}
        >
          <option value="" disabled>
            Библиотека градиентов…
          </option>
          {allPresets.map((p, i) => (
            <option value={i} key={`${p.name}-${i}`}>
              {i < gradientDefinitionPresets.length ? p.name : `★ ${p.name}`}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Тип градиента: плавный или шум"
          value={definition.kind}
          onChange={(e) =>
            set(
              e.target.value === 'noise'
                ? { ...definition, kind: 'noise', noise }
                : { ...definition, kind: 'solid' },
              false,
            )
          }
        >
          <option value="solid">Плавный</option>
          <option value="noise">Шум</option>
        </Select>
      </div>
      <label className="dialog-label">
        Название градиента
        <input
          className="dialog-input"
          aria-label="Название градиента"
          value={definition.name}
          maxLength={80}
          onChange={(e) => set({ ...definition, name: e.target.value })}
          onBlur={onFinish}
        />
      </label>
      {definition.kind === 'solid' ? (
        <GradientEditor
          stops={definition.stops}
          hidePresets
          onChange={(stops, temporary) => set({ ...definition, stops }, temporary)}
          onFinish={onFinish}
        />
      ) : (
        <div data-testid="noise-gradient-editor">
          <Slider
            label="Жёсткость шума"
            value={noise.roughness * 100}
            suffix="%"
            onChange={(v) => patchNoise({ roughness: v / 100 })}
            onCommit={onFinish}
          />
          <div className="field-grid">
            <Select
              aria-label="Модель шума"
              value={noise.model}
              onChange={(e) => {
                patchNoise({ model: e.target.value as GradientColorModel })
                onFinish()
              }}
            >
              <option value="rgb">RGB</option>
              <option value="hsb">HSB</option>
              <option value="lab">Lab</option>
            </Select>
            <Field
              label="Зерно"
              value={noise.seed}
              min={0}
              max={4294967295}
              onChange={(seed) => patchNoise({ seed: Math.floor(seed) })}
              onCommit={onFinish}
            />
          </div>
          <button
            className="compact-button"
            onClick={() => {
              patchNoise({ seed: Math.floor(Math.random() * 4294967296) })
              onFinish()
            }}
          >
            <Dices size={13} /> Случайное зерно
          </button>
          {channelLabels[noise.model].map((label, channel) => (
            <div className="field-grid" key={label}>
              <Slider
                label={`${label}: минимум`}
                value={noise.min[channel] * 100}
                suffix="%"
                onChange={(v) =>
                  patchNoise({
                    min: noise.min.map((old, i) =>
                      i === channel ? Math.min(v / 100, noise.max[i]) : old,
                    ),
                  })
                }
                onCommit={onFinish}
              />
              <Slider
                label={`${label}: максимум`}
                value={noise.max[channel] * 100}
                suffix="%"
                onChange={(v) =>
                  patchNoise({
                    max: noise.max.map((old, i) =>
                      i === channel ? Math.max(v / 100, noise.min[i]) : old,
                    ),
                  })
                }
                onCommit={onFinish}
              />
            </div>
          ))}
          {noise.transparency && (
            <div className="field-grid">
              <Slider
                label="Альфа: минимум"
                value={noise.min[3] * 100}
                suffix="%"
                onChange={(v) =>
                  patchNoise({
                    min: noise.min.map((old, i) =>
                      i === 3 ? Math.min(v / 100, noise.max[3]) : old,
                    ),
                  })
                }
                onCommit={onFinish}
              />
              <Slider
                label="Альфа: максимум"
                value={noise.max[3] * 100}
                suffix="%"
                onChange={(v) =>
                  patchNoise({
                    max: noise.max.map((old, i) =>
                      i === 3 ? Math.max(v / 100, noise.min[3]) : old,
                    ),
                  })
                }
                onCommit={onFinish}
              />
            </div>
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={noise.restrictColors}
              onChange={(e) => {
                patchNoise({ restrictColors: e.target.checked })
                onFinish()
              }}
            />
            Ограничить цвета границами диапазонов
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={noise.transparency}
              onChange={(e) => {
                patchNoise({ transparency: e.target.checked })
                onFinish()
              }}
            />
            Добавить случайную прозрачность
          </label>
          <p className="panel-note">
            Шум воспроизводится по зерну собственной моделью ФШ777; в PSD сохраняются нативные
            параметры (зерно, модель, диапазоны), но алгоритм другого редактора может дать иную
            картинку.
          </p>
        </div>
      )}
      <OpacityStopsEditor
        stops={definition.opacityStops}
        onChange={(opacityStops) => set({ ...definition, opacityStops })}
        onFinish={onFinish}
      />
      <div className="path-button-grid gradient-library-tools">
        <button
          className="compact-button"
          onClick={() => {
            const next = [
              ...library.filter((g) => g.name !== definition.name),
              structuredClone(definition),
            ].slice(-64)
            setLibrary(next)
            saveGradientLibrary(next)
          }}
        >
          <Save size={13} /> В библиотеку
        </button>
        <button
          className="compact-button"
          disabled={!library.some((g) => g.name === definition.name)}
          onClick={() => {
            const next = library.filter((g) => g.name !== definition.name)
            setLibrary(next)
            saveGradientLibrary(next)
          }}
        >
          <Trash2 size={13} /> Убрать из библиотеки
        </button>
        <button className="compact-button" onClick={() => file.current?.click()}>
          <Upload size={13} /> Импорт
        </button>
        <button
          className="compact-button"
          disabled={!library.length}
          onClick={() =>
            void downloadBlob(
              new Blob([serializeGradientLibrary(library)], { type: 'application/json' }),
              'gradients.777gradients.json',
            ).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка экспорта'))
          }
        >
          <Download size={13} /> Экспорт
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Импорт библиотеки градиентов"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          if (!picked) return
          void picked
            .text()
            .then((text) => {
              const imported = parseGradientLibraryFile(text)
              const names = new Set(imported.map((g) => g.name))
              const next = [...library.filter((g) => !names.has(g.name)), ...imported].slice(-64)
              setLibrary(next)
              saveGradientLibrary(next)
              setError('')
            })
            .catch((err: unknown) =>
              setError(err instanceof Error ? err.message : 'Ошибка импорта градиентов'),
            )
        }}
      />
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </div>
  )
}
