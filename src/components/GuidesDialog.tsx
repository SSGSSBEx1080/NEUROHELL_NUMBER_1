import { useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import type { EditorDocument } from '../types'
import {
  createGuideLayout,
  layoutOf,
  normalizeLayout,
  type DocumentLayout,
  type GuideLayoutOptions,
} from '../engine/layout'
import { ColorField, Field, IconButton, Modal, Select } from './ui'
export function GuidesDialog({
  doc,
  onApply,
  onClose,
}: {
  doc: EditorDocument
  onApply: (layout: DocumentLayout) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => structuredClone(layoutOf(doc))),
    [tab, setTab] = useState<'guides' | 'layout' | 'grid'>('guides'),
    [axis, setAxis] = useState<'x' | 'y'>('x'),
    [position, setPosition] = useState('50%'),
    [replace, setReplace] = useState(true),
    [error, setError] = useState('')
  const [pattern, setPattern] = useState<GuideLayoutOptions>({
    columns: 3,
    rows: 2,
    gutter: 16,
    marginTop: 24,
    marginRight: 24,
    marginBottom: 24,
    marginLeft: 24,
  })
  const patch = (value: Partial<DocumentLayout>) => setDraft((v) => ({ ...v, ...value }))
  const add = () => {
    const text = position.trim().replace(',', '.'),
      percent = text.endsWith('%'),
      value = Number(percent ? text.slice(0, -1) : text),
      p = percent ? (value * (axis === 'x' ? doc.width : doc.height)) / 100 : value
    if (!text || !Number.isFinite(p) || p < 0 || p > 16384) {
      setError('Положение: 0–16384 px или процент стороны холста.')
      return
    }
    if (draft.guides.length >= 200) {
      setError('До 200 направляющих на документ.')
      return
    }
    patch({
      guides: [
        ...draft.guides,
        { id: crypto.randomUUID(), axis, position: Math.round(p * 32) / 32 },
      ],
    })
    setError('')
  }
  const generate = () => {
    try {
      const next = createGuideLayout(doc.width, doc.height, pattern),
        guides = replace ? next : [...draft.guides, ...next]
      if (guides.length > 200)
        throw new Error('Макет превысит 200 направляющих. Включи замену текущих.')
      patch({ guides, showGuides: true })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Некорректный макет')
    }
  }
  const flag = (
    key:
      | 'showGuides'
      | 'locked'
      | 'showGrid'
      | 'snap'
      | 'snapGuides'
      | 'snapGrid'
      | 'snapLayers'
      | 'snapDocument',
    label: string,
  ) => (
    <label className="checkbox-row" key={key}>
      <input
        type="checkbox"
        checked={draft[key]}
        onChange={(e) => patch({ [key]: e.target.checked })}
      />
      {label}
    </label>
  )
  return (
    <Modal
      title="Направляющие, сетка и привязка"
      subtitle="Разметка документа не попадает в пиксели экспорта. Направляющие сохраняются в native PSD."
      onClose={onClose}
      wide
    >
      <div className="dialog-tabs">
        {(
          [
            ['guides', 'Направляющие'],
            ['layout', 'Макет'],
            ['grid', 'Сетка и привязка'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="guides-dialog-body">
        <div className="guide-layout-preview">
          <svg
            viewBox={`0 0 ${doc.width} ${doc.height}`}
            role="img"
            aria-label="Предпросмотр макета направляющих"
          >
            <rect width={doc.width} height={doc.height} fill="#23212b" />
            {draft.guides.map((g) => (
              <line
                key={g.id}
                x1={g.axis === 'x' ? g.position : 0}
                x2={g.axis === 'x' ? g.position : doc.width}
                y1={g.axis === 'y' ? g.position : 0}
                y2={g.axis === 'y' ? g.position : doc.height}
                stroke={draft.guideColor}
                vectorEffect="non-scaling-stroke"
                strokeWidth="1"
              />
            ))}
          </svg>
          <p>
            {doc.width} × {doc.height} · {draft.guides.length}/200
          </p>
        </div>
        <div className="guides-dialog-controls">
          {tab === 'guides' && (
            <>
              <div className="guide-flags">
                {flag('showGuides', 'Показывать направляющие')}
                {flag('locked', 'Заблокировать направляющие')}
              </div>
              <ColorField
                label="Цвет направляющих"
                value={draft.guideColor}
                onChange={(guideColor) => patch({ guideColor })}
              />
              <fieldset disabled={draft.locked} className="properties-fieldset">
                <div className="guide-add-row">
                  <Select
                    aria-label="Ось новой направляющей"
                    value={axis}
                    onChange={(e) => setAxis(e.target.value as 'x' | 'y')}
                  >
                    <option value="x">Вертикальная</option>
                    <option value="y">Горизонтальная</option>
                  </Select>
                  <input
                    className="dialog-input"
                    aria-label="Положение новой направляющей"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="px или %"
                  />
                  <IconButton icon={Plus} label="Добавить направляющую" onClick={add} />
                </div>
                <div className="guide-list">
                  {draft.guides.map((g, i) => (
                    <div className="guide-list-row" key={g.id}>
                      <span>{g.axis === 'x' ? 'X' : 'Y'}</span>
                      <Field
                        label={`Направляющая ${i + 1}, px`}
                        value={g.position}
                        min={0}
                        max={16384}
                        step={0.25}
                        onChange={(value) =>
                          patch({
                            guides: draft.guides.map((v) =>
                              v.id === g.id ? { ...v, position: Math.round(value * 32) / 32 } : v,
                            ),
                          })
                        }
                      />
                      <IconButton
                        icon={Trash2}
                        label={`Удалить направляющую ${i + 1}`}
                        onClick={() => patch({ guides: draft.guides.filter((v) => v.id !== g.id) })}
                      />
                    </div>
                  ))}
                </div>
                <button
                  className="text-button"
                  disabled={!draft.guides.length}
                  onClick={() => patch({ guides: [] })}
                >
                  Удалить все направляющие
                </button>
              </fieldset>
            </>
          )}
          {tab === 'layout' && (
            <fieldset disabled={draft.locked} className="properties-fieldset">
              <div className="field-grid">
                {(
                  [
                    ['columns', 'Колонки', 0, 24],
                    ['rows', 'Строки макета', 0, 24],
                    ['gutter', 'Межколонник, px', 0, 1024],
                    ['marginTop', 'Поле сверху', 0, 4096],
                    ['marginRight', 'Поле справа', 0, 4096],
                    ['marginBottom', 'Поле снизу', 0, 4096],
                    ['marginLeft', 'Поле слева', 0, 4096],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <Field
                    key={key}
                    label={label}
                    min={min}
                    max={max}
                    value={pattern[key]}
                    onChange={(v) => setPattern((p) => ({ ...p, [key]: Math.round(v) }))}
                  />
                ))}
              </div>
              <div className="curve-presets">
                <button
                  className="compact-button"
                  onClick={() =>
                    setPattern({
                      columns: 3,
                      rows: 3,
                      gutter: 0,
                      marginTop: 0,
                      marginRight: 0,
                      marginBottom: 0,
                      marginLeft: 0,
                    })
                  }
                >
                  Правило третей
                </button>
                <button
                  className="compact-button"
                  onClick={() =>
                    setPattern({
                      columns: 12,
                      rows: 1,
                      gutter: 8,
                      marginTop: 16,
                      marginRight: 16,
                      marginBottom: 16,
                      marginLeft: 16,
                    })
                  }
                >
                  12 колонок
                </button>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={replace}
                  onChange={(e) => setReplace(e.target.checked)}
                />
                Заменить текущие направляющие
              </label>
              <button className="action-button primary-action" onClick={generate}>
                Построить макет
              </button>
            </fieldset>
          )}
          {tab === 'grid' && (
            <>
              {flag('showGrid', 'Показывать сетку')}
              <div className="field-grid">
                <Field
                  label="Шаг сетки X"
                  value={draft.gridSize}
                  min={4}
                  max={1024}
                  suffix="px"
                  onChange={(gridSize) => patch({ gridSize })}
                />
                <Field
                  label="Шаг сетки Y"
                  value={draft.gridSizeY}
                  min={4}
                  max={1024}
                  suffix="px"
                  onChange={(gridSizeY) => patch({ gridSizeY })}
                />
                <Field
                  label="Деления сетки"
                  value={draft.subdivisions}
                  min={1}
                  max={16}
                  onChange={(subdivisions) => patch({ subdivisions: Math.round(subdivisions) })}
                />
              </div>
              <div className="guide-flags">
                {flag('snap', 'Включить привязку')}
                {flag('snapGuides', 'К направляющим')}
                {flag('snapGrid', 'К видимой сетке')}
                {flag('snapLayers', 'К границам других слоёв')}
                {flag('snapDocument', 'К краям и центру холста')}
              </div>
            </>
          )}
        </div>
      </div>
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
      <p className="panel-note">
        Тяни из линейки, чтобы создать направляющую. V перемещает её; перетаскивание за холст
        удаляет. Стрелки / Shift+стрелки — 1/10 px; Delete — удалить. Ctrl временно отключает
        привязку при перемещении слоя. Цвет и состояния отображения дополнительно хранятся в XMP.
      </p>
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          Отмена
        </button>
        <button className="primary-button" onClick={() => onApply(normalizeLayout(draft))}>
          Применить разметку
        </button>
      </footer>
    </Modal>
  )
}
