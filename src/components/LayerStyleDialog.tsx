import { useEffect, useRef, useState } from 'react'
import { Check, Paintbrush, RotateCcw, Sparkles } from 'lucide-react'
import type { Layer, LayerStyles } from '../types'
import { defaultStyles } from '../engine/styles'
import { loadImage, renderLayer } from '../engine/render'
import { ColorField, Field, Modal, Select, Slider } from './ui'

const sections = [{ id: 'stroke', name: 'Обводка', note: 'Чёткие границы. Новые акценты.' }, { id: 'shadow', name: 'Тень', note: 'Добавь немного глубины.' }, { id: 'glow', name: 'Внешнее свечение', note: 'Пусть идея светится.' }, { id: 'overlay', name: 'Наложение цвета', note: 'Новый цвет, та же форма.' }, { id: 'gradient', name: 'Градиент', note: 'Цвет, который движется.' }] as const
export function LayerStyleDialog({ layer, onClose, onApply }: { layer: Layer; onClose: () => void; onApply: (styles: LayerStyles) => void }) {
  const [styles, setStyles] = useState<LayerStyles>(() => structuredClone(layer.styles || defaultStyles()))
  const [tab, setTab] = useState<(typeof sections)[number]['id']>('stroke')
  const preview = useRef<HTMLCanvasElement>(null)
  const patch = <K extends Exclude<keyof LayerStyles, 'fillOpacity'>>(key: K, value: Partial<LayerStyles[K]>) => setStyles(s => ({ ...s, [key]: { ...s[key], ...value } }))
  useEffect(() => {
    let cancelled = false
    const draw = async () => {
      if (layer.src) await loadImage(layer.src)
      if (cancelled || !preview.current) return
      const canvas = preview.current, ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, 600, 350)
      const scale = Math.min(420 / layer.width, 210 / layer.height, 1.8)
      ctx.save(); ctx.translate((600 - layer.width * scale) / 2, (350 - layer.height * scale) / 2); ctx.scale(scale, scale)
      renderLayer(ctx, { ...layer, id: `${layer.id}-style-preview`, x: 0, y: 0, rotation: 0, visible: true, styles, opacity: 1, blendMode: 'source-over' }); ctx.restore()
    }
    void draw(); return () => { cancelled = true }
  }, [layer, styles])
  const active = styles[tab]
  return <Modal title="Характер — в деталях" subtitle={`Стиль слоя · ${layer.name}`} onClose={onClose} wide>
    <div className="style-layout"><nav className="style-navigation">{sections.map(s => <button key={s.id} className={tab === s.id ? 'selected' : ''} onClick={() => setTab(s.id)}><span className={`effect-check ${styles[s.id].enabled ? 'on' : ''}`}>{styles[s.id].enabled && <Check size={10} />}</span>{s.name}</button>)}<div className="style-fill"><Slider label="Заливка слоя" value={styles.fillOpacity * 100} onChange={v => setStyles(s => ({ ...s, fillOpacity: v / 100 }))} suffix="%" /></div></nav>
      <div className="style-controls"><div className="style-title"><span><Paintbrush size={16} />{sections.find(s => s.id === tab)!.name}</span><label className="checkbox-row"><input type="checkbox" aria-label="Включить эффект" checked={active.enabled} onChange={e => patch(tab, { enabled: e.target.checked })} />Включить</label></div><p className="panel-note">{sections.find(s => s.id === tab)!.note}</p>
        {tab === 'stroke' && <><Slider label="Размер обводки" value={styles.stroke.size} max={80} suffix=" px" onChange={size => patch('stroke', { size, enabled: true })} /><Select aria-label="Положение обводки" value={styles.stroke.position} onChange={e => patch('stroke', { position: e.target.value as LayerStyles['stroke']['position'] })}><option value="outside">Снаружи</option><option value="center">По центру</option><option value="inside">Внутри</option></Select><ColorField label="Цвет обводки слоя" value={styles.stroke.color} onChange={color => patch('stroke', { color, enabled: true })} /></>}
        {tab === 'shadow' && <><ColorField label="Цвет тени" value={styles.shadow.color} onChange={color => patch('shadow', { color, enabled: true })} /><Slider label="Размытие тени" value={styles.shadow.blur} max={100} suffix=" px" onChange={blur => patch('shadow', { blur, enabled: true })} /><div className="field-grid"><Field label="Сдвиг X" value={styles.shadow.x} min={-180} max={180} onChange={x => patch('shadow', { x, enabled: true })} /><Field label="Сдвиг Y" value={styles.shadow.y} min={-180} max={180} onChange={y => patch('shadow', { y, enabled: true })} /></div><Slider label="Непрозрачность тени" value={styles.shadow.opacity * 100} suffix="%" onChange={v => patch('shadow', { opacity: v / 100 })} /></>}
        {tab === 'glow' && <><ColorField label="Цвет свечения" value={styles.glow.color} onChange={color => patch('glow', { color, enabled: true })} /><Slider label="Радиус свечения" value={styles.glow.blur} max={100} suffix=" px" onChange={blur => patch('glow', { blur, enabled: true })} /><Slider label="Непрозрачность свечения" value={styles.glow.opacity * 100} suffix="%" onChange={v => patch('glow', { opacity: v / 100 })} /></>}
        {tab === 'overlay' && <><ColorField label="Цвет наложения" value={styles.overlay.color} onChange={color => patch('overlay', { color, enabled: true })} /><Slider label="Непрозрачность цвета" value={styles.overlay.opacity * 100} suffix="%" onChange={v => patch('overlay', { opacity: v / 100, enabled: true })} /></>}
        {tab === 'gradient' && <><div className="gradient-strip" style={{ background: `linear-gradient(${styles.gradient.angle}deg,${styles.gradient.from},${styles.gradient.to})` }} /><div className="field-grid"><ColorField label="Начало градиента" value={styles.gradient.from} onChange={from => patch('gradient', { from, enabled: true })} /><ColorField label="Конец градиента" value={styles.gradient.to} onChange={to => patch('gradient', { to, enabled: true })} /></div><Slider label="Угол градиента" value={styles.gradient.angle} max={360} suffix="°" onChange={angle => patch('gradient', { angle, enabled: true })} /><Slider label="Непрозрачность градиента" value={styles.gradient.opacity * 100} suffix="%" onChange={v => patch('gradient', { opacity: v / 100 })} /></>}
      </div></div>
    <div className="style-preview"><canvas ref={preview} width={600} height={350} /><span>Живой предпросмотр · изменения применятся по кнопке</span></div>
    <footer className="dialog-footer"><button className="text-button" onClick={() => setStyles(defaultStyles())}><RotateCcw size={14} />Сбросить стили</button><button className="primary-button" onClick={() => onApply(styles)}><Sparkles size={15} />Применить стиль</button></footer>
  </Modal>
}
