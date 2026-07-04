// Display-only formatting helpers (mobile spec G3/G4). These NEVER change stored data or any
// logic that reads dates/phones — they only format values for display.

/** G3 — relative time: <1m "now", <1h "Nm", <24h "Nh", ≤7d "Nd", older → "Jul 3". */
export function relativeTime(input: string | number | Date | null | undefined): string {
  if (input === null || input === undefined || input === '') return ''
  const d = new Date(input)
  if (isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return 'now'
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day <= 7) return `${day}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d)
}

/** G4 — US phone: +19174954300 / 19174954300 / 9174954300 → "(917) 495-4300". Non-standard
 *  inputs are returned unchanged. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw)
  const digits = s.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return s
}
