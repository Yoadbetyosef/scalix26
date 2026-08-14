// WHEN THE HERO IS A BAR.
//
// ── WHY ONE THRESHOLD CANNOT HOLD ───────────────────────────────────────────────────────────────────
//
// A single line means the state is a function of one number, and that number jitters. Momentum
// scrolling delivers sub-pixel deltas either side of a boundary, so sitting near it flips the state
// on frame after frame — and each flip starts a half-second height animation that the next flip
// reverses. What reads as flicker is the animation being restarted, not the attribute being written.
//
// Two lines instead. It takes 64px of travel to collapse, and the hero does not come back until the
// list is genuinely near the top again at 24px. Between them, whatever the state already is stays.
//
// Extracted from the scroll handler because it is the whole rule: a pure function of (state, offset)
// is testable against the exact case that was reported — a thumb resting on the boundary.

/** Past this, the portrait becomes a bar. */
export const COLLAPSE_AT = 64
/** Only below this does it come back. The gap between the two is the hysteresis. */
export const EXPAND_AT = 24

export function nextCollapsed(current: boolean, scrollTop: number): boolean {
  if (current) return scrollTop >= EXPAND_AT
  return scrollTop > COLLAPSE_AT
}
