import { useState } from 'react'
import { Gauge, Monitor, Save, ShieldCheck } from 'lucide-react'
import { defaultPreferences, type Preferences } from '../engine/preferences'
import { Modal, Select, Slider } from './ui'
export function SettingsDialog({
  value,
  onChange,
  onClose,
}: {
  value: Preferences
  onChange: (v: Preferences) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState('appearance')
  const patch = (p: Partial<Preferences>) => onChange({ ...value, ...p })
  return (
    <Modal
      title="Настройки студии"
      subtitle="Изменения применяются сразу и сохраняются на этом устройстве."
      onClose={onClose}
      wide
    >
      <div className="settings-layout">
        <nav>
          {[
            ['appearance', Monitor, 'Интерфейс'],
            ['performance', Gauge, 'Производительность'],
            ['saving', Save, 'Сохранение'],
          ].map(([id, Icon, label]) => {
            const Component = Icon as typeof Monitor
            return (
              <button
                key={id as string}
                className={tab === id ? 'selected' : ''}
                onClick={() => setTab(id as string)}
              >
                <Component size={16} />
                {label as string}
              </button>
            )
          })}
        </nav>
        <section>
          {tab === 'appearance' && (
            <>
              <h3>Тема оформления</h3>
              <div className="theme-options">
                {(['violet', 'graphite', 'warm'] as const).map((theme, i) => (
                  <button
                    className={value.theme === theme ? 'selected' : ''}
                    key={theme}
                    onClick={() => patch({ theme })}
                  >
                    <span style={{ background: ['#b7a2ff', '#a4b4c8', '#f4b486'][i] }} />
                    {['Аметист', 'Графит', 'Тёплая'][i]}
                  </button>
                ))}
              </div>
              <label className="dialog-label">
                Шахматный фон
                <Select value={value.checker} onChange={(e) => patch({ checker: +e.target.value })}>
                  {[8, 16, 24, 32].map((n) => (
                    <option key={n} value={n}>
                      {n} px
                    </option>
                  ))}
                </Select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.reduceMotion}
                  onChange={(e) => patch({ reduceMotion: e.target.checked })}
                />
                Уменьшить анимацию интерфейса
              </label>
            </>
          )}
          {tab === 'performance' && (
            <>
              <h3>Рендеринг и история</h3>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.smooth}
                  onChange={(e) => patch({ smooth: e.target.checked })}
                />
                Сглаживать масштабирование предпросмотра
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.showPerformance}
                  onChange={(e) => patch({ showPerformance: e.target.checked })}
                />
                Показывать время отрисовки кадра
              </label>
              <Slider
                label="Глубина истории"
                value={value.history}
                min={10}
                max={100}
                step={10}
                onChange={(history) => patch({ history })}
              />
              <p className="panel-note">
                Canvas 2D, requestAnimationFrame, кэш неизменённого нижнего стека и эффектов.
                Целевой бюджет истории — 128 МиБ строк изображений. Тяжёлые шаги вытесняют старые;
                текущий и один предыдущий документ сохраняются даже сверх этого бюджета.
              </p>
              <p className="panel-note">
                До 48 Мп активных источников, 256 МиБ кэша изображений. Это не лимит всей памяти
                приложения.
              </p>
            </>
          )}
          {tab === 'saving' && (
            <>
              <h3>PSD по умолчанию</h3>
              <p className="settings-copy">
                Ctrl+S сохраняет настоящий PSD с обычными слоями и объединённым изображением для
                внешних просмотрщиков. Собственные редактируемые свойства ФШ777 записываются
                дополнительно в XMP, а не вместо PSD.
              </p>
              <Slider
                label="Задержка автосохранения"
                value={value.autosave}
                min={500}
                max={10000}
                step={500}
                suffix=" мс"
                onChange={(autosave) => patch({ autosave })}
              />
              <p className="info-note">
                <ShieldCheck size={20} />
                Автосохранение хранит до 8 недавних проектов. После перезапуска можно выбрать
                восстановление на главной. Это не замена отдельному PSD на диске.
              </p>
            </>
          )}
        </section>
      </div>
      <footer className="dialog-footer">
        <button className="text-button" onClick={() => onChange({ ...defaultPreferences })}>
          Сбросить настройки
        </button>
        <button className="primary-button" onClick={onClose}>
          Готово
        </button>
      </footer>
    </Modal>
  )
}
