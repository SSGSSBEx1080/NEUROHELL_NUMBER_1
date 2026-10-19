import { useEffect, useRef, useState } from 'react'
import {
  MAX_CUBE_BYTES,
  identityCube,
  parseCubeFile,
  serializeCube,
  type CubeLut,
} from '../engine/colorLut'
import { downloadBlob } from '../engine/render'
export function ColorLookupProperties({
  lut,
  onChange,
  owner,
}: {
  lut: CubeLut
  onChange: (lut: CubeLut) => void
  owner: string
}) {
  const [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    input = useRef<HTMLInputElement>(null),
    latest = useRef(owner),
    mounted = useRef(true),
    job = useRef(0)
  latest.current = owner
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      job.current++
    }
  }, [])
  const load = async (file?: File) => {
    if (!file) return
    const id = ++job.current,
      forOwner = owner
    setWorking(true)
    setError('')
    try {
      if (!/\.cube$/i.test(file.name) || file.size > MAX_CUBE_BYTES)
        throw new Error('Выбери текстовый .cube до 2 МиБ')
      const parsed = parseCubeFile(await file.text(), file.name.replace(/\.cube$/i, ''))
      if (mounted.current && id === job.current && latest.current === forOwner) onChange(parsed)
    } catch (e) {
      if (mounted.current && id === job.current)
        setError(e instanceof Error ? e.message : 'Ошибка CUBE')
    } finally {
      if (mounted.current && id === job.current) setWorking(false)
    }
  }
  const save = async () => {
    setWorking(true)
    setError('')
    try {
      await downloadBlob(
        new Blob([serializeCube(lut)], { type: 'text/plain;charset=utf-8' }),
        `${lut.title.replace(/[<>:"/\\|?*]/g, '_')}.cube`,
      )
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Ошибка экспорта CUBE')
    } finally {
      if (mounted.current) setWorking(false)
    }
  }
  return (
    <div className="lut-properties" data-testid="lut-properties">
      <div className="lut-summary">
        <strong>{lut.title}</strong>
        <span>
          {lut.size} × {lut.size} × {lut.size} · RGB
        </span>
      </div>
      <input
        className="visually-hidden"
        ref={input}
        type="file"
        accept=".cube"
        aria-label="Загрузить файл CUBE"
        disabled={working}
        onChange={(e) => {
          void load(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <button className="action-button" disabled={working} onClick={() => input.current?.click()}>
        Загрузить 3D LUT… <span>.cube</span>
      </button>
      <button className="action-button" disabled={working} onClick={() => void save()}>
        Экспортировать эту LUT <span>↗</span>
      </button>
      <button className="text-button" disabled={working} onClick={() => onChange(identityCube())}>
        Нейтральная таблица
      </button>
      {working && (
        <p className="panel-note" role="status">
          Обработка таблицы…
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <p className="panel-note">
        CUBE 3D, 2–33 узла по оси, до 2 МиБ. Трилинейная RGB-интерполяция, DOMAIN_MIN/MAX. Таблица
        встраивается в native PSD, не требует исходного файла. 1D/shaper/3DL/LOOK/ICC и HDR-процесс
        не поддержаны.
      </p>
    </div>
  )
}
