import { useState } from 'react'
import { Gauge, Monitor, Palette, Save, ShieldCheck } from 'lucide-react'
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
            ['color', Palette, 'Цвет'],
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
          {tab === 'color' && (
            <>
              <h3>Управление цветом</h3>
              <p className="settings-copy">
                Рабочее пространство редактирования — <strong>sRGB IEC61966-2.1</strong>. PSD с
                другим поддерживаемым матричным/TRC ICC можно преобразовать в него при открытии;
                LUT/CMYK/Lab-профили распознаются, но не выдаются за преобразованные.
              </p>
              <label className="dialog-label">
                Профиль серого по умолчанию
                <Select
                  aria-label="Профиль серого по умолчанию"
                  value={value.colorGrayProfile}
                  onChange={(e) =>
                    patch({
                      colorGrayProfile: e.target.value as Preferences['colorGrayProfile'],
                    })
                  }
                >
                  <option value="sgray">sGray</option>
                  <option value="gray-gamma-2.2">Gray Gamma 2.2</option>
                  <option value="gray-gamma-1.8">Gray Gamma 1.8</option>
                </Select>
              </label>
              <label className="dialog-label">
                Если встроенный профиль PSD не совпадает
                <Select
                  aria-label="Политика несовпадения профиля PSD"
                  value={value.colorMismatchPolicy}
                  onChange={(e) =>
                    patch({
                      colorMismatchPolicy: e.target.value as Preferences['colorMismatchPolicy'],
                    })
                  }
                >
                  <option value="ask">Спрашивать при открытии</option>
                  <option value="convert">Автоматически преобразовать в sRGB</option>
                  <option value="discard">Отбрасывать профиль</option>
                  <option value="assign-working">Назначать sRGB без преобразования</option>
                </Select>
              </label>
              <label className="dialog-label">
                Если в PSD нет профиля
                <Select
                  aria-label="Политика отсутствующего профиля PSD"
                  value={value.colorMissingPolicy}
                  onChange={(e) =>
                    patch({
                      colorMissingPolicy: e.target.value as Preferences['colorMissingPolicy'],
                    })
                  }
                >
                  <option value="ask">Спрашивать при открытии</option>
                  <option value="leave">Оставлять без профиля</option>
                  <option value="assign-working">Назначать sRGB без преобразования</option>
                </Select>
              </label>
              <label className="dialog-label">
                Метод преобразования по умолчанию
                <Select
                  aria-label="Метод преобразования профиля по умолчанию"
                  value={value.colorIntent}
                  onChange={(e) =>
                    patch({ colorIntent: e.target.value as Preferences['colorIntent'] })
                  }
                >
                  <option value="relative">Относительный колориметрический</option>
                  <option value="absolute">Абсолютный колориметрический</option>
                </Select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.colorBlackPoint}
                  onChange={(e) => patch({ colorBlackPoint: e.target.checked })}
                />
                Компенсация точки чёрного
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={value.colorDither}
                  onChange={(e) => patch({ colorDither: e.target.checked })}
                />
                Дизеринг при преобразовании 8-битного цвета
              </label>
              <p className="panel-note">
                Поддерживаемые встроенные и пользовательские матричные профили: sRGB IEC61966-2.1,
                Adobe RGB (1998), Apple RGB, ColorMatch RGB, Display P3, ProPhoto RGB, Rec.2020,
                sGray, Gray Gamma и другие ICC с тегами цветовых компонентов/TRC и XYZ PCS. Плоский
                экспорт PNG/JPEG может преобразовать копию в эти назначения и встроить ICC.
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
