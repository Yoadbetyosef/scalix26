import { z } from 'zod'

// THE SIX FIELDS A PERSON MAY SET, in one place because create and edit must not drift.
//
// Not `channel` (set once by whichever door they came in through, and never true afterwards), not
// `language` (nothing writes it — it is a DB default of 'en' on every row), not `last_interaction`
// or `total_conversations` (derived). A form offering those invites the owner to fight the system.
export const CONTACT_FIELDS = ['name', 'email', 'phone', 'address', 'currency', 'notes'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]

/** Blank is allowed — the form may only have a name — but a non-empty email must still be one. */
const emailField = z.union([z.string().email().max(320), z.literal('')]).nullable().optional()

export const contactFieldsSchema = z.object({
  name: z.string().max(300).nullable().optional(),
  email: emailField,
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  currency: z.string().max(8).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
})

export type ContactFieldValues = z.infer<typeof contactFieldsSchema>
