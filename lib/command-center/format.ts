import type { Cents } from './money'

// Presentation-neutral formatters shared by the engine (CEO Brief strings) and the UI. No React here.
export function compactMoney(cents: Cents): string {
  const d = cents / 100
  const sign = d < 0 ? '-' : ''
  const abs = Math.abs(d)
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}
export const pctText = (x: number, digits = 0): string => `${(x * 100).toFixed(digits)}%`
export const num = (n: number): string => n.toLocaleString('en-US')
