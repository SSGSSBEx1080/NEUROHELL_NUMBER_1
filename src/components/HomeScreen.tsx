import {
  ArrowUpRight,
  Clock3,
  FileImage,
  FolderOpen,
  Home,
  Layers3,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react'
import { useState } from 'react'
import type { EditorDocument } from '../types'
import type { RecentProject } from '../engine/storage'
export function HomeScreen({
  recents,
  recovery,
  hasSession,
  onNew,
  onOpen,
  onDemo,
  onManga,
  onResume,
  onRecent,
  onRestore,
  onForget,
  onFonts,
  onSettings,
}: {
  recents: RecentProject[]
  recovery: EditorDocument | null
  hasSession: boolean
  onNew: () => void
  onOpen: () => void
  onDemo: () => void
  onManga: () => void
  onResume: () => void
  onRecent: (r: RecentProject) => void
  onRestore: () => void
  onForget: (id: string) => void
  onFonts: () => void
  onSettings: () => void
}) {
  const [recentOnly, setRecentOnly] = useState(false)
  return (
    <div className="studio-home" data-testid="home-screen">
      <aside className="home-sidebar">
        <div className="home-logo">
          <span>777</span>
          <div>
            <strong>ФШ 777</strong>
            <small>НЕЗАВИСИМАЯ СТУДИЯ</small>
          </div>
        </div>
        <button className="home-new" onClick={onNew}>
          <Plus size={17} />
          Создать проект
        </button>
        <button className="home-open" onClick={onOpen}>
          <FolderOpen size={17} />
          Открыть файл
        </button>
        <nav>
          <button className={!recentOnly ? 'selected' : ''} onClick={() => setRecentOnly(false)}>
            <Home size={16} />
            Начало
          </button>
          <button className={recentOnly ? 'selected' : ''} onClick={() => setRecentOnly(true)}>
            <Clock3 size={16} />
            Недавние<span>{recents.length}</span>
          </button>
          <div />
          <button onClick={onFonts}>
            <Type size={16} />
            Шрифты
          </button>
          <button onClick={onSettings}>
            <Settings2 size={16} />
            Настройки
          </button>
        </nav>
        <div className="home-sidebar-bottom">
          <ShieldCheck size={19} />
          <strong>
            Твоя работа.
            <br />
            Твоё устройство.
          </strong>
          <p>
            Без аккаунта и подписки.
            <br />
            PSD, а не закрытый формат.
          </p>
          <span>STUDIO 777 / LOCAL FIRST</span>
        </div>
      </aside>
      <main className="home-content">
        <header>
          <div>
            <span className="eyebrow">ПРОСТРАНСТВО ДЛЯ ТВОИХ ИДЕЙ</span>
            <h1>{recentOnly ? 'Недавние проекты' : 'Хороший день, чтобы создавать.'}</h1>
          </div>
          {hasSession && (
            <button className="secondary-button" onClick={onResume}>
              Вернуться к работе
              <ArrowUpRight size={15} />
            </button>
          )}
        </header>
        {!recentOnly && (
          <section className="home-hero">
            <div>
              <span className="hero-kicker">
                <span />
                ТВОЙ НОВЫЙ ЧИСТЫЙ ЛИСТ
              </span>
              <h2>
                Сначала — идея.
                <br />
                Дальше — <em>всё возможно.</em>
              </h2>
              <p>
                Слои, маски, текст и инструменты для деталей.
                <br />
                Знакомый рабочий процесс. Собственный характер.
              </p>
              <div className="home-hero-actions">
                <button className="primary-button" onClick={onNew}>
                  Новый документ
                  <Plus size={16} />
                </button>
                <button data-testid="open-demo" className="text-button" onClick={onDemo}>
                  Исследовать демопроект
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
            <div className="home-hero-art" aria-hidden="true">
              <div className="hero-orbit" />
              <div className="hero-seven">
                7<span>7</span>7
              </div>
              <span className="hero-art-caption">MAKE SOMETHING / YOURS</span>
              <div className="hero-curve" />
            </div>
          </section>
        )}
        {!recentOnly && (
          <section className="home-manga-card">
            <img src="/demo-manga.webp" alt="Учебная иллюстрация: курьер на ночной крыше" />
            <div>
              <span className="eyebrow">MANGA WORKSPACE</span>
              <h2>От скана до готовой реплики.</h2>
              <p>
                J-клининг, перевод и текстовые пузыри — на одной учебной странице. Без установки
                шрифтов и поиска исходников.
              </p>
            </div>
            <button className="secondary-button" data-testid="open-manga-demo" onClick={onManga}>
              Открыть практику
              <ArrowUpRight size={15} />
            </button>
          </section>
        )}
        {recovery && (
          <section className="recovery-card">
            <span className="recovery-icon">
              <RotateCcw size={21} />
            </span>
            <div>
              <strong>Продолжить с автосохранения?</strong>
              <p>
                «{recovery.name}» · {recovery.width} × {recovery.height} px · локальная рабочая
                копия
              </p>
            </div>
            <button className="secondary-button" data-testid="restore-project" onClick={onRestore}>
              Восстановить
              <ArrowUpRight size={14} />
            </button>
          </section>
        )}
        <div className="home-section-heading">
          <h2>
            {recentOnly ? 'Сохранено на этом устройстве' : 'Вернуться к работе'}
            <span>{recents.length}</span>
          </h2>
          <span>Последние изменения · сначала новые</span>
        </div>
        {recents.length ? (
          <div className="recent-grid">
            {recents.map((r) => (
              <article className="recent-card" key={r.id}>
                <button onClick={() => onRecent(r)} aria-label={`Открыть недавний: ${r.name}`}>
                  <div className="recent-preview checkerboard">
                    {r.thumbnail ? (
                      <img src={r.thumbnail} alt="" />
                    ) : (
                      <FileImage size={34} strokeWidth={1} />
                    )}
                    <span>PSD WORKSPACE</span>
                  </div>
                  <div className="recent-description">
                    <strong>{r.name}</strong>
                    <span>
                      {r.width} × {r.height} px
                    </span>
                    <small>
                      {new Date(r.savedAt).toLocaleString('ru-RU', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                </button>
                <button
                  className="forget-recent"
                  aria-label={`Убрать из недавних: ${r.name}`}
                  title="Убрать локальную копию из недавних. PSD на диске не удаляется."
                  onClick={() => onForget(r.id)}
                >
                  <Trash2 size={13} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-recents">
            <Layers3 size={31} strokeWidth={1} />
            <div>
              <strong>Здесь будут твои проекты</strong>
              <p>
                Создай первый документ или открой PSD. Рабочие копии останутся на этом устройстве.
              </p>
            </div>
            <button onClick={onOpen}>
              <FolderOpen size={15} />
              Открыть PSD
            </button>
          </div>
        )}
        <footer className="home-footer">
          <span>
            <Sparkles size={13} />
            Независимый редактор, не продукт Adobe.
          </span>
          <span>PSD / PSB · PNG · JPG · WEBP</span>
        </footer>
      </main>
    </div>
  )
}
