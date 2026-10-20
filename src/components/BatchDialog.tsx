import { useRef, useState } from 'react'
import { FolderOpen, Layers3, Play, Square, Upload } from 'lucide-react'
import type { StudioAction } from '../engine/actions'
import {
  MAX_BATCH_FILES,
  batchOutputName,
  processBatch,
  sanitizeSuffix,
  type BatchFormat,
  type BatchResult,
} from '../engine/batch'
import { Modal, Select, Slider } from './ui'

export function BatchDialog({
  actions,
  onClose,
  onToast,
}: {
  actions: StudioAction[]
  onClose: () => void
  onToast: (message: string) => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [actionId, setActionId] = useState('')
  const [format, setFormat] = useState<BatchFormat>('png')
  const [suffix, setSuffix] = useState('-ultra')
  const [quality, setQuality] = useState(90)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BatchResult[]>([])
  const [error, setError] = useState('')
  const [folder, setFolder] = useState<{ id: string; name: string } | undefined>()
  const input = useRef<HTMLInputElement>(null)
  const cancel = useRef(false)
  const desktop = typeof window !== 'undefined' && !!window.fsh777?.chooseBatchFolder
  const action = actions.find((a) => a.id === actionId) || null

  const chooseFolder = async () => {
    if (!window.fsh777?.chooseBatchFolder) return undefined
    const chosen = await window.fsh777.chooseBatchFolder()
    if (chosen.state === 'completed' && chosen.id) {
      const next = { id: chosen.id, name: chosen.name }
      setFolder(next)
      return next
    }
    return undefined
  }
  const run = async () => {
    setError('')
    setResults([])
    cancel.current = false
    try {
      let target = folder
      if (desktop && !target) {
        target = await chooseFolder()
        if (!target) return
      }
      setRunning(true)
      const done = await processBatch(
        files,
        action,
        { format, suffix, quality: quality / 100 },
        {
          folderId: target?.id,
          shouldCancel: () => cancel.current,
          onResult: (result) => setResults((r) => [...r, result]),
        },
      )
      const ok = done.filter((r) => r.status === 'done').length
      onToast(`Пакетная обработка: готово ${ok} из ${done.length}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка пакетной обработки')
    } finally {
      setRunning(false)
    }
  }
  const previewName = files[0]
    ? batchOutputName(files[0].name, suffix, format)
    : `фото${sanitizeSuffix(suffix)}.${format === 'jpeg' ? 'jpg' : format}`

  return (
    <Modal title="Пакетная обработка" subtitle="Операция для набора файлов" onClose={onClose} wide>
      <div data-testid="batch-dialog">
        <p className="panel-note">
          Исходные файлы только читаются и никогда не перезаписываются: результат — новые копии с
          суффиксом. В веб-версии браузер скачает каждый результат по отдельности; в приложении
          файлы складываются в выбранную папку без перезаписи существующих.
        </p>
        <div className="field-grid">
          <button
            className="compact-button"
            disabled={running}
            onClick={() => input.current?.click()}
          >
            <Upload size={13} /> Выбрать файлы ({files.length}/{MAX_BATCH_FILES})
          </button>
          {desktop && (
            <button
              className="compact-button"
              disabled={running}
              onClick={() => void chooseFolder()}
            >
              <FolderOpen size={13} /> {folder ? `Папка: ${folder.name}` : 'Папка вывода…'}
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".png,.jpg,.jpeg,.webp,.psd,.psb,.777,image/png,image/jpeg,image/webp"
          aria-label="Файлы для пакетной обработки"
          onChange={(e) => {
            setFiles(Array.from(e.target.files || []).slice(0, MAX_BATCH_FILES))
            setResults([])
            e.target.value = ''
          }}
        />
        {!!files.length && (
          <ul className="lut-stack-list">
            {files.slice(0, 12).map((f) => (
              <li key={`${f.name}-${f.size}`}>
                {f.name} <span>{Math.ceil(f.size / 1024)} КиБ</span>
              </li>
            ))}
            {files.length > 12 && <li>…и ещё {files.length - 12}</li>}
          </ul>
        )}
        <div className="field-grid">
          <Select
            aria-label="Операция для пакета"
            value={actionId}
            disabled={running}
            onChange={(e) => setActionId(e.target.value)}
          >
            <option value="">Без операции (только конвертация)</option>
            {actions.map((a) => (
              <option value={a.id} key={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Формат результата пакета"
            value={format}
            disabled={running}
            onChange={(e) => setFormat(e.target.value as BatchFormat)}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPEG (белый фон)</option>
            <option value="webp">WebP</option>
            <option value="psd">PSD (слои)</option>
          </Select>
        </div>
        <label className="dialog-label">
          Суффикс имени результата
          <input
            className="dialog-input"
            aria-label="Суффикс имени результата"
            value={suffix}
            maxLength={40}
            disabled={running}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </label>
        <p className="panel-note">
          Пример: <strong>{previewName}</strong>
          {action && ' · операция начнётся с верхнего доступного слоя каждого документа.'}
        </p>
        {(format === 'jpeg' || format === 'webp') && (
          <Slider label="Качество" value={quality} suffix="%" onChange={setQuality} />
        )}
        {!!results.length && (
          <div data-testid="batch-log">
            <span className="panel-subtitle">
              Журнал: {results.length} из {files.length}
            </span>
            <ul className="lut-stack-list">
              {results.map((r, i) => (
                <li key={i}>
                  {r.status === 'done' ? '✓' : r.status === 'cancelled' ? '■' : '✕'} {r.name}
                  {r.outputName ? ` → ${r.outputName}` : ''} <span>{r.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
      <footer className="dialog-footer">
        {running ? (
          <button className="text-button" onClick={() => (cancel.current = true)}>
            <Square size={14} /> Остановить после текущего файла
          </button>
        ) : (
          <button className="text-button" onClick={onClose}>
            Закрыть
          </button>
        )}
        <button
          className="primary-button"
          disabled={running || !files.length}
          onClick={() => void run()}
        >
          {running ? <Layers3 size={15} /> : <Play size={15} />}
          {running ? 'Обрабатываю…' : 'Запустить пакет'}
        </button>
      </footer>
    </Modal>
  )
}
