import { createAdminClient } from '@/lib/supabase/server'
import { escapeSearchTerm } from '@/lib/contacts/store'
import { withCompanyColumns } from '@/lib/contacts/company-column'

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
  company_name: string | null
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
  const FULL = 'id, name, company_name, email, phone, channel, total_conversations, last_interaction'
  // Without the migration. See lib/contacts/company-column.ts — asking for a column the database does
  // not have returns 400 and a null `data`, and this read used to report that as an empty book.
  const LEGACY = 'id, name, email, phone, channel, total_conversations, last_interaction'

  const build = (cols: string) => {
    let query = serviceSupabase
      .from('contacts')
      .select(cols, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .is('merged_into_id', null)
      // People she's actually spoken to sit on top, most recent first. Everyone else — an imported
      // book has no interactions at all — falls into a stable A–Z run instead of an arbitrary one,
      // with the contacts we can only identify by email or phone last.
      .order('last_interaction', { ascending: false, nullsFirst: false })
    // A–Z BY COMPANY FIRST, then by person. A business customer is filed under the business, which is
    // the name the owner is looking for and the one the row leads with.
    if (cols === FULL) query = query.order('company_name', { ascending: true, nullsFirst: false })
    query = query.order('name', { ascending: true, nullsFirst: false })
      .range(offset, offset + PAGE_SIZE - 1)

    const safe = escapeSearchTerm(q)
    // Searching the company has to find the contact — "yacht" finds Irina at M&P Yacht Centre. The
    // column is trigram-indexed for it (add_contact_company.sql).
    const company = cols === FULL ? `company_name.ilike.%${safe}%,` : ''
    if (safe) query = query.or(`name.ilike.%${safe}%,${company}email.ilike.%${safe}%,phone.ilike.%${safe}%,address.ilike.%${safe}%`)
    return query
  }

  const { data, count, error } = await withCompanyColumns<ContactRow[]>(FULL, LEGACY, async (cols) => {
    const { data: d, count: n, error: e } = await build(cols)
    return { data: d as ContactRow[] | null, count: n, error: e }
  })
  // NOT swallowed. The empty state means "this book is empty", and a failed read is not that — it
  // was reported as one until a missing column made twenty contacts vanish from the probe tenant.
  if (error) throw new Error(`Could not read the address book: ${error.message ?? 'unknown error'}`)
  const contacts = (data ?? []) as ContactRow[]
  const total = count ?? 0
  return { contacts, total, offset }
}
