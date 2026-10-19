import { useState } from 'react'
import type { PathController } from '../hooks/usePathTool'
import { pathNodePosition } from '../engine/pathEditing'
import { Field, Select } from './ui'
export function PathProperties({ controller: c }: { controller: PathController }) {
  const [component, setComponent] = useState(0)
  if (!c.layer || c.layer.kind !== 'shape') return null
  const index = Math.min(component, Math.max(0, c.paths.length - 1)),
    path = c.paths[index],
    single = c.nodes.length === 1 ? pathNodePosition(c.layer, c.nodes[0]) : undefined
  return (
    <div className="property-section path-properties" data-testid="path-properties">
      <div className="section-heading">
        Контуры и узлы <span>{c.paths.reduce((n, p) => n + p.knots.length, 0)} точек</span>
      </div>
      {!c.editable && (
        <p className="panel-note">
          Для правки сбрось перспективу; редактор обрабатывает до 2048 точек. Более сложные исходные
          контуры не упрощаются автоматически.
        </p>
      )}
      <button className="action-button" disabled={!c.editable} onClick={c.activate}>
        Редактировать узлы <span>A</span>
      </button>
      {c.layer.shape !== 'path' && (
        <button className="action-button" disabled={!c.editable} onClick={c.convert}>
          Преобразовать фигуру в контур
        </button>
      )}
      <fieldset disabled={!c.editable} className="path-controls">
        <Select
          aria-label="Компонент контура"
          value={index}
          onChange={(e) => setComponent(+e.target.value)}
        >
          {c.paths.map((p, i) => (
            <option key={i} value={i}>
              {i + 1}. {p.open ? 'Открытый' : 'Замкнутый'} · {p.knots.length} точек
            </option>
          ))}
        </Select>
        <div className="path-button-grid">
          <button className="compact-button" onClick={() => c.component(index, 'toggle')}>
            {path?.open ? 'Замкнуть компонент' : 'Открыть компонент'}
          </button>
          <button className="compact-button" onClick={() => c.component(index, 'reverse')}>
            Обратить направление
          </button>
          <button className="compact-button" onClick={() => c.component(index, 'duplicate')}>
            Копия компонента
          </button>
          <button
            className="compact-button"
            disabled={c.paths.length < 2}
            onClick={() => c.component(index, 'remove')}
          >
            Удалить компонент
          </button>
        </div>
        <Select
          aria-label="Правило заливки контура"
          value={path?.fillRule || 'non-zero'}
          onChange={(e) => c.setFillRule(e.target.value as 'non-zero' | 'even-odd')}
        >
          <option value="non-zero">Ненулевая сумма направлений</option>
          <option value="even-odd">Чётность · отверстия</option>
        </Select>
        <button className="action-button" onClick={c.selectAll}>
          Выбрать все узлы <span>Ctrl+A</span>
        </button>
        {single && (
          <div className="field-grid">
            <Field
              label="X узла"
              value={single.x}
              step={0.1}
              onChange={(v) => c.setPosition('x', v)}
              onCommit={c.finish}
            />
            <Field
              label="Y узла"
              value={single.y}
              step={0.1}
              onChange={(v) => c.setPosition('y', v)}
              onCommit={c.finish}
            />
          </div>
        )}
        <div className="path-button-grid">
          <button
            className="compact-button"
            disabled={!c.nodes.length}
            onClick={() => c.mode('smooth')}
          >
            Гладкие узлы
          </button>
          <button
            className="compact-button"
            disabled={!c.nodes.length}
            onClick={() => c.mode('corner')}
          >
            Угловые узлы
          </button>
          <button
            className="compact-button"
            disabled={!c.nodes.length}
            onClick={() => c.mode('independent')}
          >
            Разорвать направляющие
          </button>
          <button className="compact-button" disabled={!c.nodes.length} onClick={c.remove}>
            Удалить узлы
          </button>
          <button className="compact-button" disabled={c.nodes.length !== 2} onClick={c.join}>
            Соединить концы
          </button>
          <button
            className="compact-button"
            disabled={
              c.nodes.length !== 1 ||
              (!!c.paths[c.nodes[0]?.path]?.open &&
                c.nodes[0]?.index === c.paths[c.nodes[0]?.path]?.knots.length - 1)
            }
            onClick={() => c.split(c.nodes[0].path, c.nodes[0].index)}
          >
            Разделить сегмент
          </button>
        </div>
      </fieldset>
      <button className="action-button" onClick={() => c.toSelection()}>
        Контур в выделение <span>Ctrl+Enter</span>
      </button>
      <p className="panel-note">
        Кривая хранится в native PSD. Разделение сегмента точно сохраняет форму. Стрелки двигают
        выбранные точки; Shift — шаг 10 px. Выделение берётся из заливки контура, без обводки,
        эффектов и маски.
      </p>
    </div>
  )
}
