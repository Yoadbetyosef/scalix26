import {
  TrendingUp, MessageSquare, Calendar, Users, Bot, BookLock, FlaskConical,
  Package, Receipt, Truck, Wallet, BarChart3, FileText, CreditCard, Settings, Plug, LogOut,
} from 'lucide-react'

// ONE LABEL, ONE MARK, BOTH WIDTHS.
//
// This map existed TWICE — identically, in rail.tsx and sheet.tsx — and rail's copy carried the
// comment "the same map the sheet draws from", which was a description of an intention rather than
// of the code. Adding a destination to one left the other drawing a row with no chip, which is
// exactly what happened to Invoices: the row shipped in nav.ts, both maps were untouched, and it read
// as broken on both surfaces.
//
// Presentation only. No destination, no gating, no data — nav.ts remains the one list of what exists,
// and this says what each of its labels looks like. A label with no entry renders no chip rather than
// a placeholder, which is the right failure: an unfamiliar mark is worse than none.

export const NAV_ICONS: Record<string, typeof TrendingUp> = {
  Inbox: MessageSquare, Appointments: Calendar, Contacts: Users,
  'AI Employees': Bot, Knowledge: BookLock, 'Test AI': FlaskConical,
  // Truck stays with SUPPLIER BILLS — it is stock arriving. Expenses gets the wallet: money leaving
  // that never became stock.
  Orders: Package, Invoices: Receipt, Expenses: Wallet, 'Supplier bills': Truck,
  Analytics: BarChart3, Reports: FileText,
  'Your plan': CreditCard, Settings, Connections: Plug, 'Sign Out': LogOut,
}
// `Leads` was here and is gone with its screen (§22). A mark for a destination that does not exist is
// a row waiting to be re-added by somebody who finds the icon and assumes the page went missing.

// RUDI magenta, BUSINESS violet, ACCOUNT cyan. The heading dot, its fading rule and every icon chip
// inside a group read from this one value.
export const GROUP_HUE: Record<string, string> = { g1: 'var(--v2-t1)', g2: 'var(--v2-t3)', g3: 'var(--v2-t4)' }
