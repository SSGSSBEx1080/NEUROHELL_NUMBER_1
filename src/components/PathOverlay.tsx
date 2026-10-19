import type { PathController } from '../hooks/usePathTool'
import { nodeKey, pathSvg } from '../engine/pathEditing'
import { transformedPaths } from '../engine/shapeGeometry'
export function PathOverlay({
  controller: c,
  scale,
  color,
}: {
  controller: PathController
  scale: number
  color: string
}) {
  if (!c.active) return null
  const paths = c.editable && c.layer ? transformedPaths(c.layer) : [],
    keys = new Set(c.nodes.map(nodeKey))
  return (
    <g className="path-edit-overlay" data-testid="path-edit-overlay">
      {!!paths.length && (
        <path d={pathSvg(paths)} fill="none" stroke="#b9a4ff" strokeWidth={1 / scale} />
      )}
      {paths.flatMap((p, path) =>
        p.knots.map((k, index) => {
          const selected = keys.has(nodeKey({ path, index })),
            point = k.points
          return (
            <g key={`${path}:${index}`}>
              {selected &&
                ([0, 4] as const).map((i) => {
                  if (
                    (p.open &&
                      ((i === 0 && index === 0) || (i === 4 && index === p.knots.length - 1))) ||
                    Math.hypot(point[i] - point[2], point[i + 1] - point[3]) < 0.01
                  )
                    return null
                  return (
                    <g key={i}>
                      <line
                        x1={point[2]}
                        y1={point[3]}
                        x2={point[i]}
                        y2={point[i + 1]}
                        stroke="#b9a4ff"
                        strokeWidth={1 / scale}
                      />
                      <circle
                        cx={point[i]}
                        cy={point[i + 1]}
                        r={3.8 / scale}
                        fill="#f6f0ff"
                        stroke="#8061da"
                        strokeWidth={1 / scale}
                        data-node-path={path}
                        data-node-index={index}
                        data-node-part={i === 0 ? 'in' : 'out'}
                        data-testid="path-handle"
                        aria-label={`${i === 0 ? 'Входящая' : 'Исходящая'} направляющая ${path + 1}.${index + 1}`}
                        style={{ pointerEvents: 'all', cursor: 'crosshair' }}
                      />
                    </g>
                  )
                })}
              <rect
                x={point[2] - 4 / scale}
                y={point[3] - 4 / scale}
                width={8 / scale}
                height={8 / scale}
                fill={selected ? '#a884ff' : '#f7f1ff'}
                stroke="#6b4ba7"
                strokeWidth={1 / scale}
                data-node-path={path}
                data-node-index={index}
                data-node-part="anchor"
                data-testid="path-anchor"
                aria-label={`Узел ${path + 1}.${index + 1}`}
                style={{ pointerEvents: 'all', cursor: 'move' }}
              />
            </g>
          )
        }),
      )}
      {c.marquee && (
        <rect
          {...c.marquee}
          fill="#ad8cff22"
          stroke="#c4b1ff"
          strokeWidth={1 / scale}
          strokeDasharray={`${3 / scale} ${3 / scale}`}
        />
      )}
      {c.draft && (
        <g data-testid="pen-draft">
          <path
            d={pathSvg([{ open: true, fillRule: 'non-zero', knots: c.draft.knots }])}
            fill="none"
            stroke="#15111c"
            strokeWidth={3 / scale}
          />
          <path
            d={pathSvg([{ open: true, fillRule: 'non-zero', knots: c.draft.knots }])}
            fill="none"
            stroke={color}
            strokeWidth={1.5 / scale}
          />
          {c.hover && !!c.draft.knots.length && (
            <path
              d={`M${c.draft.knots.at(-1)!.points[2]} ${c.draft.knots.at(-1)!.points[3]}C${c.draft.knots.at(-1)!.points[4]} ${c.draft.knots.at(-1)!.points[5]} ${c.hover.x} ${c.hover.y} ${c.hover.x} ${c.hover.y}`}
              stroke="#c9b5ff"
              strokeWidth={1 / scale}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
              fill="none"
            />
          )}
          {c.draft.knots.map((k, i) => (
            <g key={i}>
              {[0, 4].map(
                (part) =>
                  Math.hypot(k.points[part] - k.points[2], k.points[part + 1] - k.points[3]) >
                    0.01 && (
                    <g key={part}>
                      <line
                        x1={k.points[2]}
                        y1={k.points[3]}
                        x2={k.points[part]}
                        y2={k.points[part + 1]}
                        stroke="#b9a4ff"
                        strokeWidth={1 / scale}
                      />
                      <circle
                        cx={k.points[part]}
                        cy={k.points[part + 1]}
                        r={3 / scale}
                        fill="#eee4ff"
                      />
                    </g>
                  ),
              )}
              <rect
                x={k.points[2] - 3.5 / scale}
                y={k.points[3] - 3.5 / scale}
                width={7 / scale}
                height={7 / scale}
                fill={i ? '#f7f1ff' : '#b18eff'}
                stroke="#6b4ba7"
                strokeWidth={1 / scale}
              />
            </g>
          ))}
        </g>
      )}
    </g>
  )
}
export function PathToolbar({ controller: c }: { controller: PathController }) {
  return (
    <div
      className="path-tool-status"
      data-testid="path-tool-status"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {c.draft ? (
        <>
          <span>
            <b>Перо</b> · {c.draft.knots.length} точек
          </span>
          <button
            className="compact-button"
            disabled={c.draft.knots.length < 2}
            onClick={() => c.finishDraft(false)}
          >
            Завершить · Enter
          </button>
          <button
            className="compact-button accent"
            disabled={c.draft.knots.length < 2}
            onClick={() => c.finishDraft(true)}
          >
            Замкнуть контур
          </button>
          <button className="compact-button" onClick={c.cancelDraft}>
            Отменить контур
          </button>
        </>
      ) : c.tool === 'pen' ? (
        <span>Клик — угол · потяни — кривая · клик по первой точке — замкнуть</span>
      ) : (
        <>
          <span>
            <b>Узлы</b> · выбрано {c.nodes.length}
          </span>
          <span>Shift — несколько · Alt — угол / разрыв усика · Ctrl+Enter — выделение</span>
        </>
      )}
    </div>
  )
}
