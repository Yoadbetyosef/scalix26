'use client'

import type { CSSProperties } from 'react'
import styles from './ai-orb.module.css'
import { useBrand } from '@/components/brand/brand-provider'

// The default Scalix voice waveform — tallest in the middle, gradient teal → blue → violet.
const HEIGHTS = [24, 34, 46, 56, 64, 70, 64, 56, 46, 34, 24]
const DEFAULT_COLORS = ['#4ECDC4', '#43C7D6', '#3FBFE6', '#4FB0EC', '#5AA6F0', '#7E9DEF', '#9A93EA', '#AE96E6', '#B79BE8', '#9FA8EA', '#6FD0D4']

// ── Brand gradient ─────────────────────────────────────────────────────────
// When a White Label partner brand is active, the waveform follows THEIR colors (primary → secondary)
// so the AI presence feels like the partner's own product. Scalix's own customers keep the original.
const isHex = (c?: string | null): c is string => !!c && /^#[0-9a-fA-F]{6}$/.test(c)
const toRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const }
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
function mix(c1: string, c2: string, t: number) {
  const [r1, g1, b1] = toRgb(c1), [r2, g2, b2] = toRgb(c2)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}
// A darker sibling of a hex color (fallback secondary when the brand only set a primary).
const darken = (h: string) => { const [r, g, b] = toRgb(h); return toHex(r * 0.6, g * 0.6, b * 0.6) }

export type OrbState = 'idle' | 'live' | 'celebration'

/**
 * The AI object — a living voice waveform inside a glassy lens wrapped in the brand gradient ring.
 * Presentation only. Props are additive & optional so existing `<AiOrb />` usages are unchanged.
 *  • state: idle (slow breathing) | live (waveform ~3x + green accent) | celebration.
 *  • eventKey: bump it to fire a one-shot ripple ring (new lead/booked).
 *  • paused: freeze all animation (tab hidden / battery) — W6 idle-CPU discipline.
 * All animations are transform/opacity only and respect prefers-reduced-motion.
 */
export function AiOrb({ state = 'idle', eventKey = 0, paused = false }: { state?: OrbState; eventKey?: number; paused?: boolean }) {
  const brand = useBrand()
  // Partner brand → interpolate the waveform across the partner's own primary → secondary colors.
  const colors = brand?.isPartnerBrand && isHex(brand.primaryColor)
    ? HEIGHTS.map((_, i) => mix(brand.primaryColor as string, isHex(brand.secondaryColor) ? (brand.secondaryColor as string) : darken(brand.primaryColor as string), i / (HEIGHTS.length - 1)))
    : DEFAULT_COLORS

  return (
    <div className={styles.root} data-state={state} data-paused={paused ? 'true' : undefined} aria-hidden="true">
      <div className={styles.glow} />
      <div className={styles.liveGlow} />
      <div className={styles.lens} />
      <div className={styles.ring} />
      <div className={styles.bars}>
        {HEIGHTS.map((h, i) => (
          <span
            key={i}
            className={styles.bar}
            style={{
              height: `${h}%`,
              background: colors[i],
              '--dur': `${1.5 + (i % 3) * 0.4}s`,
              '--delay': `${-(i * 0.16)}s`,
            } as CSSProperties}
          />
        ))}
      </div>
      {/* One-shot ripple — remounts on eventKey change so the animation replays. */}
      {eventKey > 0 && <span key={eventKey} className={styles.ripple} />}
    </div>
  )
}
