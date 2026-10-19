import { useState } from 'react'
import {
  correctionNames,
  defaultCorrection,
  parseCorrection,
  toneChannels,
  type Correction,
  type CorrectionKind,
  type ToneChannel,
  type LevelRange,
} from '../engine/adjustmentTypes'
import type { EditorDocument, Layer } from '../types'
import { CurveEditor } from './CurveEditor'
import { Histogram } from './Histogram'
import { Field, Select } from './ui'
const channelNames: Record<ToneChannel, string> = {
  rgb: 'RGB · общий',
  red: 'Красный',
  green: 'Зелёный',
  blue: 'Синий',
}
export function CorrectionProperties({
  layer,
  doc,
  onChange,
  onFinish,
}: {
  layer: Layer
  doc: EditorDocument
  onChange: (value: Correction, temporary: boolean) => void
  onFinish: () => void
}) {
  const [channel, setChannel] = useState<ToneChannel>('rgb'),
    [range, setRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones'),
    [mixer, setMixer] = useState<'red' | 'green' | 'blue'>('red')
  const c = layer.correction!
  const patch = (value: unknown, temporary = true) => onChange(parseCorrection(value), temporary)
  const control = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    change: (value: number) => void,
  ) => (
    <div className="correction-control" key={label}>
      <Field
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={change}
        onCommit={onFinish}
      />
      <input
        type="range"
        aria-label={`${label} — ползунок`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(+e.target.value)}
        onPointerUp={onFinish}
        onKeyUp={onFinish}
        onBlur={onFinish}
      />
    </div>
  )
  const scalar = (key: string, label: string, min = -100, max = 100, step = 1) =>
    control(label, (c as unknown as Record<string, number>)[key], min, max, step, (value) =>
      patch({ ...c, [key]: value }),
    )
  const level = (key: keyof LevelRange, label: string, min: number, max: number, step = 1) =>
    c.type === 'levels' &&
    control(label, c.channels[channel][key], min, max, step, (value) =>
      patch({
        ...c,
        channels: { ...c.channels, [channel]: { ...c.channels[channel], [key]: value } },
      }),
    )
  return (
    <div className="property-section correction-properties" data-testid="correction-properties">
      <div className="section-heading">
        Корректирующий слой <span className="correction-symbol">◐</span>
      </div>
      <Select
        aria-label="Тип коррекции"
        value={c.type}
        onChange={(e) => onChange(defaultCorrection(e.target.value as CorrectionKind), false)}
      >
        {Object.entries(correctionNames).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </Select>
      <Histogram doc={doc} channel={channel} />
      {(c.type === 'levels' || c.type === 'curves') && (
        <Select
          aria-label="Канал коррекции"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ToneChannel)}
        >
          {toneChannels.map((k) => (
            <option key={k} value={k}>
              {channelNames[k]}
            </option>
          ))}
        </Select>
      )}
      {c.type === 'levels' && (
        <>
          <h4>Входные уровни</h4>
          {level('black', 'Вход: чёрный', 0, c.channels[channel].white - 1)}
          {level('gamma', 'Гамма уровней', 0.1, 9.99, 0.01)}
          {level('white', 'Вход: белый', c.channels[channel].black + 1, 255)}
          <h4>Выходные уровни</h4>
          {level('outBlack', 'Выход: чёрный', 0, 255)}
          {level('outWhite', 'Выход: белый', 0, 255)}
        </>
      )}
      {c.type === 'curves' && (
        <>
          <CurveEditor
            key={`${layer.id}:${channel}`}
            points={c.channels[channel]}
            onChange={(points) => patch({ ...c, channels: { ...c.channels, [channel]: points } })}
            onFinish={onFinish}
          />
          <div className="curve-presets">
            <button
              className="compact-button"
              onClick={() =>
                patch(
                  {
                    ...c,
                    channels: {
                      ...c.channels,
                      [channel]: [
                        { input: 0, output: 0 },
                        { input: 64, output: 44 },
                        { input: 192, output: 212 },
                        { input: 255, output: 255 },
                      ],
                    },
                  },
                  false,
                )
              }
            >
              S-контраст
            </button>
            <button
              className="compact-button"
              onClick={() =>
                patch(
                  {
                    ...c,
                    channels: {
                      ...c.channels,
                      [channel]: [
                        { input: 0, output: 0 },
                        { input: 128, output: 164 },
                        { input: 255, output: 255 },
                      ],
                    },
                  },
                  false,
                )
              }
            >
              Светлее
            </button>
            <button
              className="compact-button"
              onClick={() =>
                patch(
                  {
                    ...c,
                    channels: {
                      ...c.channels,
                      [channel]: [
                        { input: 0, output: 0 },
                        { input: 255, output: 255 },
                      ],
                    },
                  },
                  false,
                )
              }
            >
              Линейная
            </button>
          </div>
        </>
      )}
      {c.type === 'brightness/contrast' && (
        <>
          {scalar('brightness', 'Яркость коррекции')}
          {scalar('contrast', 'Контрастность коррекции')}
        </>
      )}
      {c.type === 'exposure' && (
        <>
          {scalar('exposure', 'Экспозиция EV', -10, 10, 0.05)}
          {scalar('offset', 'Смещение экспозиции', -0.5, 0.5, 0.01)}
          {scalar('gamma', 'Гамма экспозиции', 0.1, 9.99, 0.01)}
        </>
      )}
      {c.type === 'hue/saturation' && (
        <>
          {scalar('hue', 'Цветовой тон', -180, 180)}
          {scalar('saturation', 'Насыщенность коррекции')}
          {scalar('lightness', 'Светлота коррекции')}
        </>
      )}
      {c.type === 'vibrance' && (
        <>
          {scalar('vibrance', 'Вибрация цвета')}
          {scalar('saturation', 'Насыщенность коррекции')}
        </>
      )}
      {c.type === 'color balance' && (
        <>
          <Select
            aria-label="Тональный диапазон"
            value={range}
            onChange={(e) => setRange(e.target.value as typeof range)}
          >
            <option value="shadows">Тени</option>
            <option value="midtones">Средние тона</option>
            <option value="highlights">Света</option>
          </Select>
          {(['red', 'green', 'blue'] as const).map((k, i) =>
            control(
              ['Голубой ↔ красный', 'Пурпурный ↔ зелёный', 'Жёлтый ↔ синий'][i],
              c[range][k],
              -100,
              100,
              1,
              (value) => patch({ ...c, [range]: { ...c[range], [k]: value } }),
            ),
          )}
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={c.preserveLuminosity}
              onChange={(e) => patch({ ...c, preserveLuminosity: e.target.checked }, false)}
            />
            Сохранять светимость
          </label>
        </>
      )}
      {c.type === 'black & white' && (
        <>
          {(['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const).map((k, i) =>
            scalar(
              k,
              [
                'Красные в Ч/Б',
                'Жёлтые в Ч/Б',
                'Зелёные в Ч/Б',
                'Голубые в Ч/Б',
                'Синие в Ч/Б',
                'Пурпурные в Ч/Б',
              ][i],
              -200,
              300,
            ),
          )}
        </>
      )}
      {c.type === 'channel mixer' && (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={c.monochrome}
              onChange={(e) => patch({ ...c, monochrome: e.target.checked }, false)}
            />
            Монохромный микшер
          </label>
          {!c.monochrome && (
            <Select
              aria-label="Выходной канал микшера"
              value={mixer}
              onChange={(e) => setMixer(e.target.value as typeof mixer)}
            >
              {(['red', 'green', 'blue'] as const).map((k) => (
                <option key={k} value={k}>
                  {channelNames[k]}
                </option>
              ))}
            </Select>
          )}
          {(['red', 'green', 'blue', 'constant'] as const).map((k, i) => {
            const key = c.monochrome ? 'gray' : mixer
            return control(
              ['Красный вклад, %', 'Зелёный вклад, %', 'Синий вклад, %', 'Константа, %'][i],
              c[key][k],
              -200,
              200,
              1,
              (value) => patch({ ...c, [key]: { ...c[key], [k]: value } }),
            )
          })}
        </>
      )}
      {c.type === 'posterize' && scalar('levels', 'Число уровней', 2, 256)}
      {c.type === 'threshold' && scalar('level', 'Уровень порога', 0, 255)}
      {c.type === 'invert' && (
        <p className="panel-note">
          Инвертирует RGB нижнего стека. Прозрачность сохраняется; силу регулируй непрозрачностью
          слоя.
        </p>
      )}
      <button className="action-button" onClick={() => onChange(defaultCorrection(c.type), false)}>
        Сбросить параметры коррекции
      </button>
      <p className="panel-note">
        Неразрушающая коррекция нижнего стека. Маска ограничивает область; обтравка — нижнюю основу.
        PSD хранит native adjustment. RGB/8 алгоритм ФШ777 может отличаться от Adobe.
      </p>
    </div>
  )
}
