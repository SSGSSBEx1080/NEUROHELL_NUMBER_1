import type { Layer } from '../types'
import { defaultTextFrame, getTextLayout, mangaTextPresets } from '../engine/textLayout'
import { useFont } from '../engine/fonts'
import { Field, Select } from './ui'

export function TextFrameSettings({
  layer,
  patch,
  finish,
}: {
  layer: Layer
  patch: (v: Partial<Layer>, label?: string, temporary?: boolean) => void
  finish: () => void
}) {
  const frame = layer.textFrame,
    result = frame ? getTextLayout(layer) : undefined
  return (
    <div className="frame-settings">
      <div className="section-heading">Рамка и пузырь</div>
      <Select
        aria-label="Режим текста"
        value={frame?.shape || 'point'}
        onChange={(e) =>
          patch(
            {
              textFrame:
                e.target.value === 'point'
                  ? undefined
                  : {
                      ...defaultTextFrame(),
                      ...frame,
                      shape: e.target.value as 'rectangle' | 'ellipse',
                    },
            },
            'Режим текстовой рамки',
          )
        }
      >
        <option value="point">Свободный текст · без переносов</option>
        <option value="rectangle">Прямоугольная рамка</option>
        <option value="ellipse">Овальный пузырь</option>
      </Select>
      {frame && (
        <>
          <div className="field-grid">
            <Field
              label="Отступ текста"
              value={frame.padding}
              min={0}
              max={256}
              onChange={(padding) => patch({ textFrame: { ...frame, padding } }, '', true)}
              onCommit={finish}
            />
            <Select
              aria-label="По вертикали"
              value={frame.verticalAlign}
              onChange={(e) =>
                patch(
                  {
                    textFrame: {
                      ...frame,
                      verticalAlign: e.target.value as typeof frame.verticalAlign,
                    },
                  },
                  'Выравнивание в рамке',
                )
              }
            >
              <option value="top">Сверху</option>
              <option value="middle">Посередине</option>
              <option value="bottom">Снизу</option>
            </Select>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={frame.autoFit}
              onChange={(e) =>
                patch(
                  { textFrame: { ...frame, autoFit: e.target.checked } },
                  'Автоподбор размера текста',
                )
              }
            />
            Авторазмер по рамке
          </label>
          {frame.autoFit && (
            <Field
              label="Минимальный кегль"
              value={frame.minFontSize}
              min={4}
              max={layer.fontSize || 48}
              onChange={(minFontSize) => patch({ textFrame: { ...frame, minFontSize } }, '', true)}
              onCommit={finish}
            />
          )}
          <p
            className={`frame-status ${result?.overflow ? 'overflow' : ''}`}
            role="status"
            data-testid="text-layout-status"
          >
            {result?.overflow
              ? `Переполнение${result.limited ? ' · достигнут предел расчёта' : ''}. Увеличь рамку или сократи текст.`
              : `${result?.lines.length} строк · ${result?.fontSize} px${frame.autoFit ? ' / авто' : ''}`}
          </p>
          <p className="panel-note">
            «Размер» — верхняя граница авторазмера. Рамка меняет переносы, не растягивает буквы.
            Shift+T — нарисовать новую.
          </p>
        </>
      )}
      <div className="manga-presets" aria-label="Пресеты тайпсета">
        {mangaTextPresets.map((preset) => (
          <button
            key={preset.name}
            className="compact-button"
            onClick={() =>
              void useFont(preset.values.fontFamily!).then(() =>
                patch(preset.values, `Тайпсет: ${preset.name}`),
              )
            }
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  )
}
