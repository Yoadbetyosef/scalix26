import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeEmail, normalizePhone } from '@/lib/contacts/store'

// ── EVERY ORDER BELONGS TO A CUSTOMER RECORD ────────────────────────────────────────────────────
//
// 21 of TG's 36 orders had no contact_id. The order form lets a name be typed for a walk-in, and
// most of them were: the picker offers a match while typing, and a jeweller with a customer at the
// counter does not stop to pick. So the orders held a name, an email and a phone as free text, and
// the customer's profile knew nothing about any of them — a returning customer's history was
// whatever somebody remembered.
//
// Now an order that is not linked links ITSELF, at creation and on edit:
//
//   1. the email, then the phone, is matched against the address book the same way the book's own
//      duplicate check matches (normalised, last ten digits) — so the walk-in who emailed last year
//      is recognised, not duplicated;
//   2. no match, and something identifying was typed: a contact is created from what the order
//      already holds. Nothing is re-entered; the company goes to company_name and the person to
//      name, the same split the address book makes.
//
// Nothing on the ORDER changes: customer_name / email / phone stay as typed, because an order is a
// snapshot of who it was for at the time. Only contact_id is filled. The typed values were not
// wrong, they were just not connected.
//
// What is NOT done: guessing by name alone. Two "Artin"s in a book of 232 is one person or two,
// and linking on the name would merge them silently. A name-only order gets a new contact, and the
// address book's merge tool exists for the day it turns out to be the same person.

export interface OrderCustomerFields {
  contactId?: string | null
  customerName?: string | null
  customerCompany?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
}

type Db = SupabaseClient

/** Find the contact this order's customer already is, by email then phone. Null when there is none. */
export async function findContactForOrder(db: Db, tenantId: string, c: OrderCustomerFields): Promise<string | null> {
  const email = normalizeEmail(c.customerEmail)
  const phone = normalizePhone(c.customerPhone)
  if (!email && !phone) return null
  const base = () => db.from('contacts').select('id').eq('tenant_id', tenantId).is('merged_into_id', null).is('archived_at', null)
  if (email) {
    // normalized_email is written by the address book's own create path; older rows may only have
    // `email`, so both are tried, case-insensitively.
    const { data } = await base().or(`normalized_email.eq.${email},email.ilike.${email.replace(/[%,()]/g, '')}`).limit(1)
    if (data?.[0]?.id) return data[0].id as string
  }
  if (phone) {
    const { data } = await base().or(`normalized_phone.eq.${phone},phone.ilike.%${phone}`).limit(1)
    if (data?.[0]?.id) return data[0].id as string
  }
  return null
}

/** Something to identify a person by — a name, a company, an email or a phone. */
export const identifiesSomeone = (c: OrderCustomerFields): boolean =>
  Boolean((c.customerName ?? '').trim() || (c.customerCompany ?? '').trim() || normalizeEmail(c.customerEmail) || normalizePhone(c.customerPhone))

/**
 * The contact_id an order should carry. Returns the one it already has, else a match, else a
 * freshly created contact, else null when nothing identifying was typed. `created` says which.
 */
export async function resolveContactForOrder(db: Db, tenantId: string, c: OrderCustomerFields): Promise<{ contactId: string | null; created: boolean; matched: boolean }> {
  if (c.contactId) return { contactId: c.contactId, created: false, matched: false }
  if (!identifiesSomeone(c)) return { contactId: null, created: false, matched: false }
  const found = await findContactForOrder(db, tenantId, c)
  if (found) return { contactId: found, created: false, matched: true }

  const name = (c.customerName ?? '').trim() || null
  const company = (c.customerCompany ?? '').trim() || null
  const email = (c.customerEmail ?? '').trim() || null
  const phone = (c.customerPhone ?? '').trim() || null
  const row = {
    tenant_id: tenantId, name, company_name: company, email, phone,
    normalized_email: normalizeEmail(email), normalized_phone: normalizePhone(phone),
    total_conversations: 0,
  }
  let { data, error } = await db.from('contacts').insert(row).select('id').single()
  if (error && (error.code === '42703' || error.code === 'PGRST204')) {
    // add_contact_company.sql not run: the company has nowhere to go but the name, which is what
    // the address book did before it had the column.
    const legacy = { ...row, name: name ?? company } as Record<string, unknown>
    delete legacy.company_name
    ;({ data, error } = await db.from('contacts').insert(legacy).select('id').single())
  }
  if (error || !data) return { contactId: null, created: false, matched: false }
  return { contactId: data.id as string, created: true, matched: false }
}
