import { useId } from 'react'

/**
 * Original ФШ777 ULTRA mark: three sevens as a speed trail on an energy gradient.
 * The same geometry lives in public/favicon.svg; desktop icons are generated
 * from it by scripts/generate-icons.mjs.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="0.55" stopColor="#00c2ff" />
          <stop offset="1" stopColor="#00ffa3" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13 22h11l-7 22" opacity="0.55" />
        <path d="M26 22h11l-7 22" opacity="0.8" />
        <path d="M39 22h11l-7 22" />
      </g>
    </svg>
  )
}
