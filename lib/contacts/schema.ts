import { z } from 'zod'

// THE FIELDS A PERSON MAY SET, in one place because create and edit must not drift.
//
// `name` stays in the list and stays the canonical display string for a person. When first_name and
// last_name are given the store DERIVES it from them, so a contact edited through the new form still
// reads correctly on every screen that only knows about `name` — see lib/contacts/names.ts for why
// that is the shape rather than composing everything into one column.
//
// Not `channel` (set once by whichever door they came in through, and never true afterwards), not
// `language` (nothing writes it — it is a DB default of 'en' on every row), not `last_interaction`
// or `total_conversations` (derived). A form offering those invites the owner to fight the system.
export const CONTACT_FIELDS = [
  'name', 'company_name', 'first_name', 'last_name', 'email', 'phone', 'address', 'currency', 'notes',
] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

/** Blank is allowed — the form may only have a name — but a non-empty email must still be one. */
const emailField = z.union([z.string().email().max(320), z.literal('')]).nullable().optional()

export const contactFieldsSchema = z.object({
  name: z.string().max(300).nullable().optional(),
  // A business customer. Optional, and absent on every private customer — which is most of them.
  company_name: z.string().max(300).nullable().optional(),
  // The person at that business. Offered for every contact, not only B2B ones: a private customer
  // whose surname you know is worth recording properly too.
  first_name: z.string().max(150).nullable().optional(),
  last_name: z.string().max(150).nullable().optional(),
  email: emailField,
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export type ContactFieldValues = z.infer<typeof contactFieldsSchema>
