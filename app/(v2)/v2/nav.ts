// EVERY DESTINATION IN /v2, IN ONE PLACE.
//
// The rail and the mobile sheet are two surfaces onto one navigation, and they had two copies of it:
// the rail's list lived inline in home-client and the sheet's was a four-tile grid built in data.ts,
// with the module gating applied separately to each. That is the arrangement that drifts — the sheet
// was already missing ten of the thirteen destinations and carrying one ("Calls") that is not a
// destination at all.
//
// One source, gated once. A destination with no `href` has no screen yet and renders inert on both
// surfaces; it must never be a link to nothing.

export interface Dest {
  label: string
  /** Absent = not built yet. Inert on both surfaces until it exists. */
  href?: string
  /** The module key /dashboard gates this behind, if any. */
  module?: string
  /** Signs out — styled apart from the rest. */
  out?: boolean
  /**
   * A row that DOES something rather than going somewhere.
   *
   * The model only knew `href`, so anything without one rendered inert — and Sign Out inherited
   * "disabled" from a shape that had no way to say "this is an action". It lives here rather than in
   * either navigation surface, or the second one to need it would grow its own copy.
   */
  action?: 'signout'
}

export interface Group {
  id: string
  label: string
  items: Dest[]
}

/** The four primary destinations. These are the ones that carry a count. */
export const PRIMARY: Dest[] = [
  { label: 'Leads', href: '/v2/leads', module: 'pipeline' },
  // One inbox, three groups, every channel — and Miles's panel at the top of it. There was briefly a
  // second row here for a separate Messages screen; two inboxes is one more than a person has.
  { label: 'Inbox', href: '/v2/inbox', module: 'inbox' },
  { label: 'Appointments', href: '/v2/appointments', module: 'scheduling' },
  { label: 'Contacts', href: '/v2/contacts', module: 'contacts' },
]

export const GROUPS: Group[] = [
  { id: 'g1', label: 'Rudi', items: [
      { label: 'AI Employees', href: '/v2/agents' },
      // Knowledge has no route of its own: it is a section of an AI employee's detail screen
      // (components/ai-employees/knowledge-base-editor.tsx inside app/ai-employees/[id]). Inert until
      // that screen exists in v2 — a link to nothing is worse than a row that does nothing.
      { label: 'Knowledge' },
      { label: 'Test AI', href: '/v2/test-ai', module: 'ai_voice' },
    ] },
  {
    id: 'g2',
    label: 'Business',
    items: [{ label: 'Orders', href: '/v2/orders', module: 'orders' }, { label: 'Analytics', href: '/v2/analytics', module: 'analytics' }, { label: 'Reports', href: '/v2/reports', module: 'analytics' }],
  },
  { id: 'g3', label: 'Account', items: [{ label: 'Billing' }, { label: 'Connections', href: '/v2/settings/connections' }, { label: 'Settings', href: '/v2/settings' }, { label: 'Sign Out', out: true, action: 'signout' }] },
]

/** Applied once, to both surfaces. A tenant without the module never sees the row. */
export const allowed = (items: Dest[], modules: string[]): Dest[] =>
  items.filter((d) => !d.module || modules.includes(d.module))

export const visibleGroups = (modules: string[]): Group[] =>
  GROUPS.map((g) => ({ ...g, items: allowed(g.items, modules) })).filter((g) => g.items.length > 0)
