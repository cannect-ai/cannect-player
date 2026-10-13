import type { CSSProperties, ReactNode } from 'react'

/** The two outer half-dividers meet at the physical seam of the LED cylinder. */
export function PlayerFrame({
  dividerPx,
  portrait,
  className = '',
  children
}: {
  dividerPx: number
  portrait: boolean
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className={`stage player-frame ${portrait ? 'player-frame--portrait' : ''} ${className}`}
      style={{ '--player-divider': `${dividerPx}px` } as CSSProperties}
    >
      <div className="player-frame-content">{children}</div>
    </div>
  )
}
