import { createAdminClient } from '@/lib/supabase/server'

// One contact and their conversations, moved here VERBATIM from app/contacts/[id]/page.tsx.
//
// Same reason as listContactsPage: the queries were written inline in the page's render, so /v2's
// contact screen had no way to ask for the same rows. Both pages call this now.
//
// ── THE BODY IS UNCHANGED ───────────────────────────────────────────────────────────────────────────
//
// Extracted programmatically. Two mechanical edits, both about where control flow belongs rather than
// what is fetched: the admin client is created here instead of being closed over, and the missing-row
// case RETURNS NULL instead of calling notFound() — notFound() is a routing decision and belongs to
// the page, not to a reader. Every filter, every column and both orderings are byte-identical.

// The columns the two pages actually read, typed. `select('*')` returns more than this, so the index
// signature keeps the row honest about that rather than pretending these are all of them.
export interface ContactRecord {
  id: string
  name: string | null; email: string | null; phone: string | null; address: string | null
  channel: string | null; language: string | null; notes: string | null
  total_conversations: number | null; last_interaction: string | null
  created_at: string; updated_at: string | null
  [key: string]: unknown
}

export interface ContactProfile {
  contact: ContactRecord
  conversations: Array<{
    id: string; channel: string | null; status: string | null; summary: string | null
    created_at: string; updated_at: string
  }>
}

export async function readContactProfile(tenantId: string, id: string): Promise<ContactProfile | null> {
  const { data: contact } = await createAdminClient()
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!contact) return null

  const { data: conversations } = await createAdminClient()
    .from('conversations')
    .select('id, channel, status, summary, created_at, updated_at')
    .eq('contact_id', id)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(50)

  return { contact: contact as ContactRecord, conversations: (conversations ?? []) as ContactProfile['conversations'] }
}
