import type { CSSProperties } from 'react'
import styles from './ai-orb.module.css'

// A calm voice waveform: tallest in the middle, gradient teal → blue → violet.
const BARS = [
  { h: 24, c: '#4ECDC4' },
  { h: 34, c: '#43C7D6' },
  { h: 46, c: '#3FBFE6' },
  { h: 56, c: '#4FB0EC' },
  { h: 64, c: '#5AA6F0' },
  { h: 70, c: '#7E9DEF' },
  { h: 64, c: '#9A93EA' },
  { h: 56, c: '#AE96E6' },
  { h: 46, c: '#B79BE8' },
  { h: 34, c: '#9FA8EA' },
  { h: 24, c: '#6FD0D4' },
]

/**
 * The Scalix AI object — a living voice waveform inside a glassy lens wrapped in the
 * brand gradient ring. The signature visual element of the product, shared between
 * the website and the app. Decorative (aria-hidden), zero client JS.
 */
export function AiOrb() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.glow} />
      <div className={styles.lens} />
      <div className={styles.ring} />
      <div className={styles.bars}>
        {BARS.map((b, i) => (
          <span
            key={i}
            className={styles.bar}
            style={{
              height: `${b.h}%`,
              background: b.c,
              '--dur': `${1.5 + (i % 3) * 0.4}s`,
              '--delay': `${-(i * 0.16)}s`,
            } as CSSProperties}
          />
        ))}
      </div>
    </div>
  )
}
