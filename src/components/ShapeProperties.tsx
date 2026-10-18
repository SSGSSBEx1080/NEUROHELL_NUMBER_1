import { useState } from 'react'
import { Link2, Unlink2, Pentagon } from 'lucide-react'
import type { Layer } from '../types'
import { shapeNames } from '../engine/shapeGeometry'
import { ColorField, Field, IconButton, Select } from './ui'
export function ShapeProperties({
  layer,
  patch,
  finish,
}: {
  layer: Layer
  patch: (values: Partial<Layer>, label?: string, temporary?: boolean) => void
  finish: () => void
}) {
  const [linked, setLinked] = useState(!layer.cornerRadii || new Set(layer.cornerRadii).size === 1)
  const radii = layer.cornerRadii || [
    layer.radius || 0,
    layer.radius || 0,
    layer.radius || 0,
    layer.radius || 0,
  ]
  const corner = (index: number, value: number) =>
    patch(
      {
        cornerRadii: radii.map((v, i) =>
          linked || i === index ? value : v,
        ) as Layer['cornerRadii'],
      },
      '',
      true,
    )
  const update = (values: Partial<Layer>) => patch(values, 'Свойства фигуры')
  const dash = layer.strokeDash || [],
    dashKind = !dash.length ? 'solid' : dash[0] === 0 ? 'dotted' : 'dashed'
  return (
    <div className="property-section shape-properties" data-testid="shape-properties">
      <div className="section-heading">
        Векторная фигура <Pentagon size={14} />
      </div>
      <Select
        aria-label="Вид фигуры"
        value={layer.shape || 'rectangle'}
        onChange={(e) => update({ shape: e.target.value as Layer['shape'] })}
      >
        {Object.entries(shapeNames).map(([key, label]) => (
          <option key={key} value={key} disabled={key === 'path'}>
            {label}
          </option>
        ))}
      </Select>
      {layer.shape === 'path' && (
        <p className="panel-note">
          {layer.shapePaths?.reduce((n, p) => n + p.knots.length, 0)} узлов Безье · масштаб, цвет и
          обводка остаются редактируемыми.
        </p>
      )}
      {(layer.shape === 'polygon' || layer.shape === 'star') && (
        <div className="field-grid shape-controls">
          <Field
            label={layer.shape === 'star' ? 'Лучи' : 'Стороны'}
            value={layer.sides || 5}
            min={3}
            max={64}
            onChange={(sides) => patch({ sides: Math.round(sides) }, '', true)}
            onCommit={finish}
          />
          {layer.shape === 'star' && (
            <Field
              label="Внутр. %"
              value={(layer.starRatio ?? 0.45) * 100}
              min={2}
              max={98}
              onChange={(v) => patch({ starRatio: v / 100 }, '', true)}
              onCommit={finish}
            />
          )}
        </div>
      )}
      <div className="section-heading subheading">Заливка</div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          aria-label="Заливка фигуры"
          checked={layer.shapeFill !== false && layer.shape !== 'line'}
          disabled={layer.shape === 'line'}
          onChange={(e) => update({ shapeFill: e.target.checked })}
        />
        Заливка включена
      </label>
      <ColorField
        label="Цвет фигуры"
        value={layer.color}
        onChange={(color) => patch({ color }, '', true)}
        onCommit={finish}
      />
      {(!layer.shape || layer.shape === 'rectangle') && (
        <>
          <div className="section-heading subheading">
            Скругление углов
            <IconButton
              icon={linked ? Link2 : Unlink2}
              label="Связать радиусы углов"
              active={linked}
              aria-pressed={linked}
              onClick={() => setLinked((v) => !v)}
            />
          </div>
          <div className="corner-fields field-grid">
            {[
              'Верхний левый угол',
              'Верхний правый угол',
              'Нижний левый угол',
              'Нижний правый угол',
            ].map((label, position) => {
              const index = [0, 1, 3, 2][position]
              return (
                <Field
                  key={label}
                  label={label}
                  value={radii[index]}
                  min={0}
                  max={2000}
                  suffix="px"
                  onChange={(v) => corner(index, v)}
                  onCommit={finish}
                />
              )
            })}
          </div>
          <p className="panel-note">
            Радиусы ограничиваются сторонами фигуры; исходные значения сохраняются при изменении
            размера.
          </p>
        </>
      )}
      <div className="section-heading subheading">Обводка</div>
      <div className="field-grid">
        <ColorField
          label="Цвет обводки"
          value={layer.strokeColor || layer.color}
          onChange={(strokeColor) =>
            patch({ strokeColor, strokeWidth: layer.strokeWidth || 2 }, '', true)
          }
          onCommit={finish}
        />
        <Field
          label="Толщ."
          value={layer.strokeWidth || 0}
          min={0}
          max={200}
          suffix="px"
          onChange={(strokeWidth) =>
            patch({ strokeWidth, strokeColor: layer.strokeColor || layer.color }, '', true)
          }
          onCommit={finish}
        />
      </div>
      <div className="field-grid shape-controls">
        <Select
          aria-label="Положение обводки"
          value={layer.shape === 'line' ? 'center' : layer.strokeAlign || 'center'}
          disabled={layer.shape === 'line'}
          onChange={(e) => update({ strokeAlign: e.target.value as Layer['strokeAlign'] })}
        >
          <option value="inside">Внутри</option>
          <option value="center">По центру</option>
          <option value="outside">Снаружи</option>
        </Select>
        <Select
          aria-label="Рисунок обводки"
          value={dashKind}
          onChange={(e) =>
            update({
              strokeDash:
                e.target.value === 'solid'
                  ? []
                  : e.target.value === 'dotted'
                    ? [0, Math.max(2, (layer.strokeWidth || 2) * 3)]
                    : [12, 6],
              ...(e.target.value === 'dotted' ? { strokeCap: 'round' } : {}),
            })
          }
        >
          <option value="solid">Сплошная</option>
          <option value="dashed">Штрихи</option>
          <option value="dotted">Точки</option>
        </Select>
        <Select
          aria-label="Концы обводки"
          value={layer.strokeCap || 'butt'}
          onChange={(e) => update({ strokeCap: e.target.value as Layer['strokeCap'] })}
        >
          <option value="butt">Плоские концы</option>
          <option value="round">Круглые концы</option>
          <option value="square">Квадратные концы</option>
        </Select>
        <Select
          aria-label="Стыки обводки"
          value={layer.strokeJoin || 'miter'}
          onChange={(e) => update({ strokeJoin: e.target.value as Layer['strokeJoin'] })}
        >
          <option value="miter">Острые стыки</option>
          <option value="round">Круглые стыки</option>
          <option value="bevel">Скошенные стыки</option>
        </Select>
      </div>
      {(layer.strokeJoin || 'miter') === 'miter' && (
        <Field
          label="Предел острия"
          value={layer.strokeMiterLimit || 4}
          min={1}
          max={20}
          step={0.1}
          onChange={(strokeMiterLimit) => patch({ strokeMiterLimit }, '', true)}
          onCommit={finish}
        />
      )}
      {!!dash.length && (
        <div className="field-grid shape-controls">
          <Field
            label="Штрих"
            value={dash[0]}
            min={0}
            max={2000}
            onChange={(v) => patch({ strokeDash: [v, dash[1] || 1] }, '', true)}
            onCommit={finish}
          />
          <Field
            label="Пробел"
            value={dash[1] || 1}
            min={0.1}
            max={2000}
            onChange={(v) => patch({ strokeDash: [dash[0], v] }, '', true)}
            onCommit={finish}
          />
          <Field
            label="Сдвиг штрихов"
            value={layer.strokeDashOffset || 0}
            min={-2000}
            max={2000}
            onChange={(strokeDashOffset) => patch({ strokeDashOffset }, '', true)}
            onCommit={finish}
          />
        </div>
      )}
      <p className="panel-note">
        PSD: нативный векторный контур, заливка и обводка — не плоская картинка.
      </p>
    </div>
  )
}
