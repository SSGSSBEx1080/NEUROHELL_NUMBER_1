import { useRef, useState } from 'react'
import { Check, Download, FolderOpen, Monitor, Search, Trash2, Type } from 'lucide-react'
import {
  fontCatalog,
  importedFonts,
  installFont,
  installGoogleFont,
  loadSystemFonts,
  removeFont,
  useFont,
} from '../engine/fonts'
import { useFonts } from '../hooks/useFonts'
import { Modal } from './ui'
export function FontsDialog({
  onClose,
  onChoose,
}: {
  onClose: () => void
  onChoose: (family: string) => void
}) {
  const fonts = useFonts(),
    [tab, setTab] = useState<'installed' | 'catalog'>('installed'),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const job = async (name: string, action: () => Promise<void>) => {
    setBusy(name)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить шрифт')
    } finally {
      setBusy('')
    }
  }
  const choose = async (family: string) => {
    await useFont(family)
    onChoose(family)
    onClose()
  }
  return (
    <Modal
      title="Библиотека шрифтов"
      subtitle="Системные, собственные и Google Fonts. Установленные шрифты работают офлайн."
      onClose={busy ? () => {} : onClose}
      wide
    >
      <div className="font-actions">
        <button
          className="secondary-button"
          disabled={!!busy}
          onClick={() =>
            void job('Читаем системные шрифты…', async () => {
              const count = await loadSystemFonts()
              setNotice(`Получены системные шрифты: ${count}. Файлы шрифтов не копировались.`)
            })
          }
        >
          <Monitor size={15} />
          Шрифты компьютера
        </button>
        <button className="primary-button" disabled={!!busy} onClick={() => input.current?.click()}>
          <FolderOpen size={15} />
          Загрузить TTF / OTF
        </button>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        aria-label="Загрузить файл шрифта"
        type="file"
        accept=".ttf,.otf"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          void job('Устанавливаем шрифты…', async () => {
            for (const file of files.slice(0, 16))
              await installFont(await file.arrayBuffer(), file.name)
            setNotice(`Установлено файлов: ${Math.min(files.length, 16)}`)
          })
        }}
      />
      <div className="help-tabs">
        <button
          className={tab === 'installed' ? 'selected' : ''}
          onClick={() => setTab('installed')}
        >
          Доступные · {fonts.length}
        </button>
        <button className={tab === 'catalog' ? 'selected' : ''} onClick={() => setTab('catalog')}>
          Google Fonts · {fontCatalog.length}
        </button>
      </div>
      <label className="font-search">
        <Search size={15} />
        <input
          aria-label="Поиск шрифтов"
          placeholder="Название шрифта…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="font-library">
        {tab === 'installed'
          ? fonts
              .filter((f) => f.toLowerCase().includes(search.toLowerCase()))
              .map((family) => (
                <div className="font-library-row" key={family}>
                  <button disabled={!!busy} onClick={() => void choose(family)}>
                    <Type size={15} />
                    <span style={{ fontFamily: family }}>{family}</span>
                    <small>Выбрать</small>
                  </button>
                  {importedFonts()
                    .filter((f) => f.family === family)
                    .map((record) => (
                      <button
                        className="font-remove"
                        key={record.id}
                        title="Удалить из локальной библиотеки (не из Windows)"
                        aria-label={`Удалить шрифт ${family}`}
                        disabled={!!busy}
                        onClick={() =>
                          void job('Удаляем шрифт…', async () => {
                            await removeFont(record.id)
                            setNotice(
                              'Удалён из ФШ777. В проектах с этим шрифтом может потребоваться замена.',
                            )
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    ))}
                </div>
              ))
          : fontCatalog
              .filter((f) => f.family.toLowerCase().includes(search.toLowerCase()))
              .map((f) => (
                <div className="font-library-row" key={f.id}>
                  <span>
                    <strong>{f.family}</strong>
                    <small>
                      SIL OFL ·{' '}
                      {f.bundled ? 'Встроен в приложение' : 'Загрузка из google/fonts на GitHub'}
                    </small>
                  </span>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() =>
                      fonts.includes(f.family)
                        ? void choose(f.family)
                        : void job(`Загружаем ${f.family}…`, async () => {
                            const result = await installGoogleFont(f.id)
                            setNotice(`${result.family} установлен. Доступен офлайн.`)
                          })
                    }
                  >
                    {fonts.includes(f.family) ? (
                      <>
                        <Check size={14} />
                        Выбрать
                      </>
                    ) : (
                      <>
                        <Download size={14} />
                        Установить
                      </>
                    )}
                  </button>
                </div>
              ))}
      </div>
      {busy && <p className="info-note">{busy}</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="font-notice">{notice}</p>}
      <p className="help-footnote">
        Шрифты не встраиваются в PSD автоматически: лицензии сторонних шрифтов могут это запрещать.
        Объединённое изображение PSD сохраняет внешний вид текста; для редактирования на другом ПК
        нужен тот же шрифт. Загрузка каталога требует интернета. Windows-версия читает список
        шрифтов локально при запуске; в браузере доступ к системным шрифтам запрашивается по кнопке.
      </p>
    </Modal>
  )
}
