import type { SupabaseClient } from '@supabase/supabase-js'

// IS THIS THE FIRST TIME THIS PERSON HAS EVER COME IN?
//
// The fact the owner actually wants and the product did not have. `leads` cannot answer it: a lead
// row is one ARRIVAL, so twelve of them on the live table are four people, and a customer's fifth
// call opens a fifth lead that looks exactly like their first.
//
// It is a property of the CONTACT — their earliest conversation, whatever channel it came in on.
//
// One function, two callers: the inbox marks the row, and the home screen counts today's. Deriving
// it twice is how the screen and the figure describing it come to disagree.

export interface ConvLike {
  id: string
  contact_id: string | null
  created_at: string
}

/**
 * Of the conversations given, which are that contact's FIRST ever.
 *
 * Bounded by the contacts present in `convs`, not by the table: one read of those people's
 * conversation timestamps, nothing else. A conversation with no contact can never be judged and is
 * never returned — an unattached row is not evidence of a new person.
 */
export async function firstConversationIds(
  db: SupabaseClient,
  tenantId: string,
  convs: ConvLike[],
): Promise<Set<string>> {
  const withContact = convs.filter((c) => !!c.contact_id)
  const contactIds = [...new Set(withContact.map((c) => c.contact_id as string))]
  if (!contactIds.length) return new Set()

  const { data, error } = await db
    .from('conversations')
    .select('contact_id, created_at')
    .eq('tenant_id', tenantId)
    .in('contact_id', contactIds)
  // Fail CLOSED: an error here must not mark every thread as a new customer. Saying nothing is new
  // is wrong in the direction nobody notices; saying everyone is new is wrong on every row.
  if (error || !data) return new Set()

  const earliest = new Map<string, number>()
  for (const r of data as { contact_id: string | null; created_at: string }[]) {
    if (!r.contact_id) continue
    const t = +new Date(r.created_at)
    const seen = earliest.get(r.contact_id)
    if (seen === undefined || t < seen) earliest.set(r.contact_id, t)
  }

  return new Set(
    withContact
      .filter((c) => earliest.get(c.contact_id as string) === +new Date(c.created_at))
      .map((c) => c.id),
  )
}
