import { useState } from 'react'
import { Sun } from 'lucide-react'
import type { GlobalLightSettings } from '../types'
import { normalizeGlobalLight } from '../engine/globalLight'
import { Field, Modal, Slider } from './ui'

export function GlobalLightDialog({
  value,
  explicit,
  linkedCount,
  onClose,
  onApply,
}: {
  value: GlobalLightSettings
  explicit: boolean
  linkedCount: number
  onClose: () => void
  onApply: (light: GlobalLightSettings) => void
}) {
  const [light, setLight] = useState<GlobalLightSettings>(() => normalizeGlobalLight(value))
  const setAngle = (angle: number) =>
    setLight((current) => normalizeGlobalLight({ ...current, angle }))
  const setAltitude = (altitude: number) =>
    setLight((current) => normalizeGlobalLight({ ...current, altitude }))
  const radians = (light.angle * Math.PI) / 180
  const sourceX = 60 + Math.cos(radians) * 42
  const sourceY = 60 - Math.sin(radians) * 42
  const shadowX = 60 - Math.cos(radians) * 24
  const shadowY = 60 + Math.sin(radians) * 24

  return (
    <Modal
      title="Глобальный свет"
      subtitle="Один источник для связанных теней и фасок"
      onClose={onClose}
    >
      <div data-testid="global-light-dialog">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '128px minmax(0, 1fr)',
            gap: 18,
            alignItems: 'center',
          }}
        >
          <svg
            width="120"
            height="120"
            viewBox="0 0 120 120"
            role="img"
            aria-label={`Источник света под углом ${Math.round(light.angle)} градусов и высотой ${Math.round(light.altitude)} градусов`}
          >
            <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" opacity="0.28" />
            <line x1="10" y1="60" x2="110" y2="60" stroke="currentColor" opacity="0.16" />
            <line x1="60" y1="10" x2="60" y2="110" stroke="currentColor" opacity="0.16" />
            <rect x="48" y="48" width="24" height="24" rx="3" fill="currentColor" opacity="0.72" />
            <circle cx={shadowX} cy={shadowY} r="9" fill="currentColor" opacity="0.28" />
            <line x1={sourceX} y1={sourceY} x2="60" y2="60" stroke="currentColor" strokeWidth="2" />
            <circle
              cx={sourceX}
              cy={sourceY}
              r={5 + light.altitude / 18}
              fill="currentColor"
              aria-hidden="true"
            />
          </svg>
          <div>
            <p className="panel-note">
              {explicit
                ? 'В документе уже задан явный мастер. Применение перепишет угол связанных Drop Shadow и Inner Shadow с сохранением их расстояний, а у связанных Bevel & Emboss — угол и высоту.'
                : 'Явного мастера в документе пока нет: показаны угол и высота первого включённого связанного эффекта или стандартные 120°/30°. Применение создаст мастер документа и синхронизирует связанные эффекты.'}
            </p>
            <p className="panel-note">Сейчас включено связанных эффектов: {linkedCount}.</p>
          </div>
        </div>
        <Slider
          label="Угол глобального света"
          value={light.angle}
          min={-180}
          max={180}
          suffix="°"
          onChange={setAngle}
        />
        <Slider
          label="Высота глобального света"
          value={light.altitude}
          min={0}
          max={90}
          suffix="°"
          onChange={setAltitude}
        />
        <div className="field-grid">
          <Field
            label="Угол"
            value={light.angle}
            min={-180}
            max={180}
            suffix="°"
            onChange={setAngle}
          />
          <Field
            label="Высота"
            value={light.altitude}
            min={0}
            max={90}
            suffix="°"
            onChange={setAltitude}
          />
        </div>
        <p className="panel-note">
          0° — свет справа, 90° — сверху, 120° — сверху слева; тень уходит в противоположную
          сторону. Высота влияет только на Bevel &amp; Emboss. Satin не является эффектом
          глобального света и не изменится. Изменение применяется одним шагом истории, включая
          заблокированные слои верхнего уровня; содержимое смарт-объектов сохраняет собственный
          документ.
        </p>
      </div>
      <footer className="dialog-footer">
        <button className="secondary-button" onClick={onClose}>
          Отмена
        </button>
        <button className="primary-button" onClick={() => onApply(normalizeGlobalLight(light))}>
          <Sun size={15} /> Применить глобальный свет
        </button>
      </footer>
    </Modal>
  )
}
