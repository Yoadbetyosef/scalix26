// CROSSING INTO THE CLASSIC SCREENS, AND FINDING THE WAY BACK.
//
// A handful of things a customer can do in v1 have no /v2 equivalent yet — creating an order, editing
// what Rudi knows, the plan, the catalog, the studio. Until they do, /v2 needs a labelled door rather
// than a missing capability.
//
// ── WHY A COOKIE AND NOT ?from= ─────────────────────────────────────────────────────────────────
//
// Because ?from= does not survive, and the place it fails is the exact place the way back matters
// most. Measured, not assumed:
//
//   components/orders/order-form.tsx:47   router.push(`/orders/${j.order.id}`)   — params dropped
//   app/catalog/new/page.tsx              router.push(`/catalog/${id}?created=1`) — params REPLACED
//   app/landed-cost/page.tsx              window.location.href = …                — params dropped
//
// and none of those targets reads searchParams at all. So somebody crosses to create an order, the
// order is created, they land on the new order's page — and the pill has vanished at the one moment
// they need it. A cookie survives that hop, and every hop after it, however deep they wander.
//
// It is also readable on the SERVER, so the pill renders with the page instead of appearing a frame
// later once a client component has read sessionStorage.
//
// ── IT REMEMBERS WHERE, NOT JUST THAT ───────────────────────────────────────────────────────────
//
// The value is the /v2 path they left from, so the pill can say "Back to Appointments" rather than
// "Back". Two clicks deep in v1, "back" is a question; the screen's name is an answer.

/** Short-lived, path-wide, readable by the v1 layout on the server. */
export const CROSSING_COOKIE = 'scalix_from_v2'

/** Long enough to finish a job in v1, short enough that a stale one does not haunt a later session. */
export const CROSSING_MAX_AGE_SECONDS = 2 * 60 * 60

/**
 * Where a crossing may point.
 *
 * An allowlist rather than a free string: the cookie decides where a pill sends somebody, and a value
 * that could be set to anything would be an open redirect wearing a friendly label.
 */
const RETURNABLE: Record<string, string> = {
  '/v2': 'Home',
  '/v2/inbox': 'Inbox',
  '/v2/appointments': 'Appointments',
  '/v2/contacts': 'Contacts',
  '/v2/orders': 'Orders',
  '/v2/invoices': 'Invoices',
  '/v2/bills': 'Supplier bills',
  '/v2/agents': 'AI Employees',
  '/v2/analytics': 'Analytics',
  '/v2/reports': 'Reports',
  '/v2/settings': 'Settings',
}

export interface Crossing { href: string; label: string }

/**
 * WHERE A CROSSING MAY GO, by key.
 *
 * Callers say `<ClassicLink to="newOrder" />` and never name a v1 URL, which is not tidiness: a file
 * containing "/orders/new" is precisely what no-escape.test.ts is written to catch, and exempting
 * every caller would have widened the hole instead of closing it. The URLs live here, the door lives
 * in classic-link.tsx, and the guard's "only one file may declare a crossing" stays true.
 */
export const CROSSINGS = {
  newOrder:     { href: '/orders/new',            label: 'New order',        why: 'Creating one still opens the classic screen' },
  aiEmployees:  { href: '/ai-employees',          label: 'Edit an employee', why: 'Knowledge, playbook and voice are on the classic screen' },
  catalog:      { href: '/catalog',               label: 'Product catalog',  why: 'Products, costs and the names Rudi hears' },
  studio:       { href: '/studio',                label: 'Design Studio',    why: 'Variants and QR product pages' },
  availability: { href: '/settings/availability', label: 'Availability',     why: 'The weekly slots Rudi books against' },
} as const

export type CrossingKey = keyof typeof CROSSINGS

/**
 * Read a cookie value into a safe destination, or null.
 *
 * Anything not on the list is discarded rather than trusted — including a path that merely starts
 * with /v2, because "/v2/../admin" starts with /v2 too.
 */
export function parseCrossing(raw: string | null | undefined): Crossing | null {
  if (!raw) return null
  // DECODED HERE, because crossingCookieValue() encodes. "/v2/orders" is written as %2Fv2%2Forders,
  // so a lookup against the raw value misses every time — and misses SILENTLY: no pill, no error,
  // and the way back simply never appears. A malformed value throws rather than returning garbage,
  // so it is caught rather than trusted.
  let href: string
  try {
    href = decodeURIComponent(raw.trim())
  } catch {
    return null
  }
  const label = RETURNABLE[href]
  return label ? { href, label } : null
}

/** The label for a /v2 path, when setting the cookie. Null means "not a place worth returning to". */
export const crossingLabelFor = (path: string): string | null => RETURNABLE[path] ?? null

/** The document.cookie string the crossing control writes. One place, so the read and write agree. */
export const crossingCookieValue = (fromPath: string): string =>
  `${CROSSING_COOKIE}=${encodeURIComponent(fromPath)}; path=/; max-age=${CROSSING_MAX_AGE_SECONDS}; samesite=lax`

/** Clearing it — same attributes, zero age. Anything else leaves a cookie the browser keeps. */
export const crossingCookieCleared = (): string =>
  `${CROSSING_COOKIE}=; path=/; max-age=0; samesite=lax`
