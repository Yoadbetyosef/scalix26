import { createAdminClient } from '@/lib/supabase/server'
import { escapeSearchTerm } from '@/lib/contacts/store'

// The contacts page's own read, moved here VERBATIM from app/contacts/page.tsx.
//
// ── WHY IT MOVED ────────────────────────────────────────────────────────────────────────────────────
//
// Same reason getDashboardData moved: it was written inline in a page's render, so a second screen
// wanting the same rows had no way to ask for them. /v2's contacts list needed the identical window
// onto the address book — same slice, same ordering, same search — and the alternative was a
// reimplementation that would quietly differ from the page it mirrors.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically rather than retyped. The only edits are mechanical: the client and the
// tenant are parameters instead of closed-over values, and the paging maths that followed it stays in
// the page. Every filter, every order and every column is byte-identical.

export const CONTACTS_PAGE_SIZE = 50

export interface ContactRow {
  id: string; name: string | null; email: string | null; phone: string | null
  channel: string | null; total_conversations: number; last_interaction: string | null
}

export async function listContactsPage(
  tenantId: string,
  { q = '', page = 1, pageSize = CONTACTS_PAGE_SIZE }: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ contacts: ContactRow[]; total: number; offset: number }> {
  const serviceSupabase = createAdminClient()
  const PAGE_SIZE = pageSize
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE

  // An imported address book is far larger than a book that filled up one conversation at a time, so
  // the page is a window onto it: a count for the header, a slice for the table, and search over the
  // whole book rather than over whatever the slice happened to contain.
  let query = serviceSupabase
    .from('contacts')
    .select('id, name, email, phone, channel, total_conversations, last_interaction', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .is('merged_into_id', null)
    // People she's actually spoken to sit on top, most recent first. Everyone else — an imported book
    // has no interactions at all — falls into a stable A–Z run instead of an arbitrary one, with the
    // contacts we can only identify by email or phone last.
    .order('last_interaction', { ascending: false, nullsFirst: false })
    .order('name', { ascending: true, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1)

  const safe = escapeSearchTerm(q)
  if (safe) query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%,address.ilike.%${safe}%`)

  const { data, count } = await query
  const contacts = (data ?? []) as ContactRow[]
  const total = count ?? 0
  return { contacts, total, offset }
}
