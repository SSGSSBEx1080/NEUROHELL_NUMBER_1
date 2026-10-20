import { useMemo, useRef, useState } from 'react'
import { FileUp, Palette } from 'lucide-react'
import type { EditorDocument } from '../types'
import {
  WORKING_RGB_PROFILE,
  builtinColorProfiles,
  parseIccProfile,
  type ColorProfileKind,
  type ColorProfileModel,
} from '../engine/colorProfiles'
import type { DocumentColorDecision } from '../engine/documentColor'
import type { Preferences } from '../engine/preferences'
import type { PsdColorProfileReport } from '../engine/psd'
import { Modal, Select } from './ui'

function ProfilePicker({
  kind,
  value,
  onChange,
  label,
}: {
  kind: ColorProfileKind
  value: ColorProfileModel
  onChange: (model: ColorProfileModel) => void
  label: string
}) {
  const [customName, setCustomName] = useState('')
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const profiles = useMemo(() => builtinColorProfiles(kind), [kind])
  const selected = value.source === 'builtin' ? value.id : 'custom'

  const load = async (file: File | undefined) => {
    if (!file) return
    setError('')
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error('ICC-профиль больше 32 МБ')
      const parsed = parseIccProfile(new Uint8Array(await file.arrayBuffer()))
      if (!parsed) throw new Error('Это не корректный ICC-профиль')
      if (!parsed.model || parsed.unsupportedReason)
        throw new Error(parsed.unsupportedReason || 'Профиль не поддерживается')
      if (parsed.model.kind !== kind)
        throw new Error(
          kind === 'rgb'
            ? 'Нужен RGB-профиль для RGB-документа'
            : 'Нужен профиль оттенков серого для grayscale-файла',
        )
      setCustomName(parsed.name)
      onChange(parsed.model)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось прочитать ICC')
    }
  }

  return (
    <div className="color-profile-picker">
      <label className="dialog-label">
        {label}
        <Select
          aria-label={label}
          value={selected}
          onChange={(e) => {
            const next = profiles.find((profile) => profile.id === e.target.value)
            if (next) onChange(next)
            else if (e.target.value === 'custom') input.current?.click()
          }}
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
          <option value="custom">
            {customName ? `Файл ICC: ${customName}` : 'Загрузить файл ICC…'}
          </option>
        </Select>
      </label>
      <button type="button" className="secondary-button" onClick={() => input.current?.click()}>
        <FileUp size={15} />
        ICC…
      </button>
      <input
        ref={input}
        hidden
        type="file"
        accept=".icc,.icm,application/vnd.iccprofile"
        onChange={(e) => {
          void load(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function ConversionOptions({
  intent,
  setIntent,
  blackPoint,
  setBlackPoint,
  dither,
  setDither,
  absoluteSupported,
}: {
  intent: 'relative' | 'absolute'
  setIntent: (v: 'relative' | 'absolute') => void
  blackPoint: boolean
  setBlackPoint: (v: boolean) => void
  dither: boolean
  setDither: (v: boolean) => void
  absoluteSupported: boolean
}) {
  return (
    <fieldset className="color-conversion-options">
      <legend>Параметры преобразования</legend>
      <label className="dialog-label">
        Метод (intent)
        <Select
          aria-label="Метод преобразования профиля"
          value={intent}
          onChange={(e) => setIntent(e.target.value as 'relative' | 'absolute')}
        >
          <option value="relative">Относительный колориметрический</option>
          <option value="absolute" disabled={!absoluteSupported}>
            Абсолютный колориметрический{absoluteSupported ? '' : ' — нет chad/точки белого'}
          </option>
        </Select>
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={blackPoint}
          onChange={(e) => setBlackPoint(e.target.checked)}
        />
        Компенсация точки чёрного
      </label>
      <label className="checkbox-row">
        <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} />
        Дизеринг 8-битного результата
      </label>
      <p className="panel-note">
        Перцепционный и насыщенный методы требуют таблиц ICC; для матричных профилей они не
        имитируются другой формулой.
      </p>
    </fieldset>
  )
}

export interface PsdColorProfileChoice {
  decision: DocumentColorDecision
  rememberMismatch?: Preferences['colorMismatchPolicy']
  rememberMissing?: Preferences['colorMissingPolicy']
}

export function PsdColorProfileDialog({
  fileName,
  report,
  preferences,
  busy,
  onCancel,
  onApply,
}: {
  fileName: string
  report: PsdColorProfileReport
  preferences: Preferences
  busy?: boolean
  onCancel: () => void
  onApply: (choice: PsdColorProfileChoice) => void
}) {
  const missing = report.status === 'missing'
  const canConvert = report.conversionSupported && !!report.sourceModel
  const [action, setAction] = useState<
    'convert' | 'discard' | 'assign-working' | 'leave-untagged' | 'assign-profile'
  >(missing ? 'leave-untagged' : canConvert ? 'convert' : 'discard')
  const kind: ColorProfileKind = report.mode === 'grayscale' ? 'gray' : 'rgb'
  const [assigned, setAssigned] = useState<ColorProfileModel>(() =>
    kind === 'gray'
      ? builtinColorProfiles('gray').find((p) => p.id === preferences.colorGrayProfile)!
      : builtinColorProfiles('rgb').find((p) => p.id === 'adobe-rgb-1998')!,
  )
  const [intent, setIntent] = useState<'relative' | 'absolute'>(preferences.colorIntent)
  const [blackPoint, setBlackPoint] = useState(preferences.colorBlackPoint)
  const [dither, setDither] = useState(preferences.colorDither)
  const [remember, setRemember] = useState(false)
  const absoluteSupported =
    action === 'assign-profile' ? !!assigned.absoluteWhite : !!report.sourceModel?.absoluteWhite

  const apply = () => {
    const conversion = { intent, blackPointCompensation: blackPoint, dither }
    if (action === 'convert') {
      if (!report.sourceModel) return
      onApply({
        decision: { action: 'convert', source: report.sourceModel, ...conversion },
        rememberMismatch: remember ? 'convert' : undefined,
      })
    } else if (action === 'assign-profile') {
      onApply({
        decision: { action: 'assign-and-convert', assigned, ...conversion },
      })
    } else if (action === 'assign-working') {
      onApply({
        decision: { action: 'assign-working', sourceLabel: report.embeddedName },
        rememberMismatch: remember && !missing ? 'assign-working' : undefined,
        rememberMissing: remember && missing ? 'assign-working' : undefined,
      })
    } else {
      onApply({
        decision: {
          action: missing ? 'leave-untagged' : 'discard',
          sourceLabel: report.embeddedName,
        },
        rememberMismatch: remember && !missing ? 'discard' : undefined,
        rememberMissing: remember && missing ? 'leave' : undefined,
      })
    }
  }

  return (
    <Modal
      title={missing ? 'Отсутствует цветовой профиль' : 'Несоответствие встроенного профиля'}
      subtitle={
        missing
          ? 'В PSD нет ICC, поэтому числа цвета сами по себе не говорят, в каком пространстве их читать.'
          : 'Встроенный профиль файла отличается от рабочего пространства редактора.'
      }
      onClose={busy ? () => {} : onCancel}
    >
      <div className="color-profile-facts">
        <span>
          Файл<strong>{fileName}</strong>
        </span>
        <span>
          Встроенный профиль
          <strong>{report.embeddedName || 'не обнаружен (ресурс 1039)'}</strong>
        </span>
        <span>
          Режим PSD
          <strong>{report.mode === 'grayscale' ? 'Оттенки серого / 8 бит' : 'RGB / 8 бит'}</strong>
        </span>
        <span>
          Рабочее пространство<strong>{WORKING_RGB_PROFILE.name}</strong>
        </span>
        {report.profile && (
          <span>
            ICC
            <strong>
              v{report.profile.version} · {(report.profile.size / 1024).toFixed(1)} КБ ·{' '}
              {report.profile.colorSpace}/{report.profile.pcs}
            </strong>
          </span>
        )}
      </div>

      <div
        className="color-profile-options"
        role="radiogroup"
        aria-label="Что сделать с профилем PSD"
      >
        {missing ? (
          <>
            <label className="color-profile-option">
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'leave-untagged'}
                onChange={() => setAction('leave-untagged')}
              />
              <span>
                <strong>Оставить как есть (без управления цветом)</strong>
                <small>
                  Числа не меняются; документ останется без профиля и показывается как sRGB.
                </small>
              </span>
            </label>
            <label className="color-profile-option">
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'assign-working'}
                onChange={() => setAction('assign-working')}
              />
              <span>
                <strong>Назначить рабочее пространство {WORKING_RGB_PROFILE.name}</strong>
                <small>Числа не меняются; теперь они официально считаются sRGB.</small>
              </span>
            </label>
            <label className="color-profile-option">
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'assign-profile'}
                onChange={() => setAction('assign-profile')}
              />
              <span>
                <strong>Назначить профиль и преобразовать в рабочее sRGB</strong>
                <small>
                  Выбери пространство, в котором числа были созданы на самом деле: sGray и Gray
                  Gamma доступны для grayscale, Adobe RGB/P3/ProPhoto и файл ICC — для RGB.
                </small>
              </span>
            </label>
            {action === 'assign-profile' && (
              <ProfilePicker
                kind={kind}
                value={assigned}
                onChange={setAssigned}
                label="Назначаемый профиль"
              />
            )}
          </>
        ) : (
          <>
            <label className={`color-profile-option ${canConvert ? '' : 'disabled'}`}>
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'convert'}
                disabled={!canConvert}
                onChange={() => setAction('convert')}
              />
              <span>
                <strong>Преобразовать цвета документа в рабочее пространство</strong>
                <small>
                  {canConvert
                    ? 'Пиксели и заданные цвета пересчитываются через XYZ PCS. Корректирующие слои и смешивание дальше работают уже в sRGB, поэтому сложный стек может отличаться; цвета вне гамуты sRGB ограничиваются.'
                    : report.reason || 'Этот тип профиля нельзя преобразовать.'}
                </small>
              </span>
            </label>
            <label className="color-profile-option">
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'discard'}
                onChange={() => setAction('discard')}
              />
              <span>
                <strong>Отбросить встроенный профиль (без управления цветом)</strong>
                <small>
                  Числа не меняются; при сохранении пересобранного PSD ICC не записывается.
                </small>
              </span>
            </label>
            <label className="color-profile-option">
              <input
                type="radio"
                name="psd-color-action"
                checked={action === 'assign-working'}
                onChange={() => setAction('assign-working')}
              />
              <span>
                <strong>Назначить рабочее sRGB без преобразования</strong>
                <small>
                  Числа не меняются и начинают считаться sRGB; внешний вид может измениться.
                </small>
              </span>
            </label>
          </>
        )}
      </div>

      {(action === 'convert' || action === 'assign-profile') && (
        <ConversionOptions
          intent={intent}
          setIntent={setIntent}
          blackPoint={blackPoint}
          setBlackPoint={setBlackPoint}
          dither={dither}
          setDither={setDither}
          absoluteSupported={absoluteSupported}
        />
      )}

      <p className="panel-note">
        <Palette size={15} /> Photoshop также умеет оставить встроенный профиль рабочим
        пространством документа. Ядро ФШ777 ULTRA пока редактирует в sRGB, поэтому здесь этот
        вариант не притворяется доступным: преобразование выше сохраняет внешний вид, а исходный
        файл на диске в любом случае не трогается.
      </p>
      {action !== 'assign-profile' && (
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Запомнить выбор для таких PSD и больше не спрашивать
        </label>
      )}
      <footer className="dialog-footer">
        <button className="text-button" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button className="primary-button" onClick={apply} disabled={busy}>
          {busy ? 'Преобразуем…' : 'Открыть'}
        </button>
      </footer>
    </Modal>
  )
}

export function DocumentProfileDialog({
  doc,
  preferences,
  busy,
  onClose,
  onApply,
}: {
  doc: EditorDocument
  preferences: Preferences
  busy?: boolean
  onClose: () => void
  onApply: (decision: DocumentColorDecision) => void
}) {
  const [action, setAction] = useState<'assign-working' | 'discard' | 'assign-profile'>(
    'assign-working',
  )
  const [assigned, setAssigned] = useState<ColorProfileModel>(
    builtinColorProfiles('rgb').find((p) => p.id === 'adobe-rgb-1998')!,
  )
  const [intent, setIntent] = useState<'relative' | 'absolute'>(preferences.colorIntent)
  const [blackPoint, setBlackPoint] = useState(preferences.colorBlackPoint)
  const [dither, setDither] = useState(preferences.colorDither)

  return (
    <Modal
      title="Цветовой профиль документа"
      subtitle="Назначение меняет интерпретацию чисел; преобразование меняет сами числа, сохраняя вид."
      onClose={busy ? () => {} : onClose}
    >
      <div className="color-profile-facts">
        <span>
          Документ<strong>{doc.name}</strong>
        </span>
        <span>
          Текущий профиль
          <strong>
            {doc.colorProfile?.status === 'untagged'
              ? 'Без профиля (предпросмотр sRGB)'
              : doc.colorProfile?.name || WORKING_RGB_PROFILE.name}
          </strong>
        </span>
        <span>
          Рабочее пространство<strong>{WORKING_RGB_PROFILE.name}</strong>
        </span>
      </div>
      <div
        className="color-profile-options"
        role="radiogroup"
        aria-label="Действие с профилем документа"
      >
        <label className="color-profile-option">
          <input
            type="radio"
            name="document-color-action"
            checked={action === 'assign-working'}
            onChange={() => setAction('assign-working')}
          />
          <span>
            <strong>Назначить рабочее {WORKING_RGB_PROFILE.name}</strong>
            <small>
              Пиксели и цвета не меняются; при сохранении PSD/PNG/JPEG встраивается sRGB.
            </small>
          </span>
        </label>
        <label className="color-profile-option">
          <input
            type="radio"
            name="document-color-action"
            checked={action === 'discard'}
            onChange={() => setAction('discard')}
          />
          <span>
            <strong>Не управлять цветом этого документа</strong>
            <small>
              Пиксели не меняются; пересобранный PSD и плоский экспорт останутся без ICC.
            </small>
          </span>
        </label>
        <label className="color-profile-option">
          <input
            type="radio"
            name="document-color-action"
            checked={action === 'assign-profile'}
            onChange={() => setAction('assign-profile')}
          />
          <span>
            <strong>Назначить другой RGB-профиль и преобразовать в рабочее sRGB</strong>
            <small>
              Для случая «числа на самом деле Adobe RGB/P3/ProPhoto, но файл был без профиля или с
              неверной меткой». Действие можно отменить через историю.
            </small>
          </span>
        </label>
        {action === 'assign-profile' && (
          <ProfilePicker
            kind="rgb"
            value={assigned}
            onChange={setAssigned}
            label="Профиль, в котором читать текущие числа"
          />
        )}
      </div>
      {action === 'assign-profile' && (
        <ConversionOptions
          intent={intent}
          setIntent={setIntent}
          blackPoint={blackPoint}
          setBlackPoint={setBlackPoint}
          dither={dither}
          setDither={setDither}
          absoluteSupported={!!assigned.absoluteWhite}
        />
      )}
      <p className="panel-note">
        Преобразование готовой плоской копии в sGray, Adobe RGB, Display P3 и другие назначения
        выполняется в «Экспорт изображения…»: там пиксели действительно пересчитываются и ICC
        встраивается в PNG/JPEG.
      </p>
      <footer className="dialog-footer">
        <button className="text-button" onClick={onClose} disabled={busy}>
          Отмена
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => {
            if (action === 'assign-profile')
              onApply({
                action: 'assign-and-convert',
                assigned,
                intent,
                blackPointCompensation: blackPoint,
                dither,
              })
            else if (action === 'discard') onApply({ action: 'discard' })
            else onApply({ action: 'assign-working' })
          }}
        >
          {busy ? 'Применяем…' : 'Применить'}
        </button>
      </footer>
    </Modal>
  )
}
