import { looksLikeName } from '@/lib/utils'
import type { SupabaseClient } from '@supabase/supabase-js'

// THE ONLY WAY AN AUTOMATED PATH MAY WRITE A CONTACT'S NAME.
//
// There were three, each with its own idea of the rules:
//
//   /api/conversations/voice     filtered with looksLikeName, guarded .is('name', null)
//   /api/appointments/book       NO filter,                   guarded .is('name', null)
//   Speed-to-Lead                NO filter,                   guarded .is('name', null)
//
// Two of the four names on the live tenant are strings looksLikeName explicitly REJECTS — "Yes. It's
// your aunt." and "What?" — which is only possible because two of the three sites never called it.
// A rule applied at one of three call sites is not a rule; it is a coincidence.
//
// ── TWO GUARDS, AND THEY ARE DIFFERENT QUESTIONS ────────────────────────────────────────────────
//
//   looksLikeName            is this a name, or is it a sentence the customer happened to say?
//   manual_fields            has a PERSON decided what goes here?
//
// `.is('name', null)` alone answers neither. It means "no name yet", which is the same shape as "the
// owner deliberately cleared the wrong one" — so clearing a bad name handed it straight back to the
// AI on the next call. `manual_fields` is what makes an owner's decision, including a decision that
// the field should be EMPTY, expressible at all.
//
// Both are kept. Dropping the null check would let an automated write replace a name the AI itself
// captured earlier and better, which nobody asked for.

/** The field name recorded in `contacts.manual_fields` when an owner sets or clears the name. */
export const NAME_FIELD = 'name'

/**
 * Is this string a name rather than something the customer happened to say?
 *
 * Re-exported from here so the INSERT paths — which create a contact and cannot use the update guard
 * — apply the same test as the update. Two of the four names on the live tenant got in through an
 * insert, so the filter has to cover both doors or it covers neither.
 */
export const looksLikeCapturedName = (v: string | null | undefined): boolean => looksLikeName(v)

export type NameWriteOutcome = 'written' | 'rejected' | 'already-decided' | 'failed'

/**
 * Write a name captured by an automated path, if it is a name and if nobody has decided otherwise.
 *
 * Best-effort: it is called from webhooks and post-call routes where the customer's conversation
 * matters more than the bookkeeping, so it never throws.
 *
 * Returns `rejected` when the string is not a name — worth distinguishing from `already-decided`,
 * because a run of rejections is the voice server's heuristic drifting, not owners editing.
 */
export async function writeCapturedName(
  db: SupabaseClient,
  contactId: string | null | undefined,
  raw: string | null | undefined,
): Promise<NameWriteOutcome> {
  if (!contactId) return 'failed'
  const name = (raw ?? '').trim()
  if (!looksLikeName(name)) {
    if (name) console.log('[contacts] captured name rejected:', JSON.stringify(name))
    return 'rejected'
  }

  try {
    const { data, error } = await db
      .from('contacts')
      .update({ name })
      .eq('id', contactId)
      // No name yet, AND nobody has decided what belongs here. An owner who cleared a wrong name has
      // decided; `.is('name', null)` on its own cannot tell that apart from never having been asked.
      .is('name', null)
      .not('manual_fields', 'cs', `{${NAME_FIELD}}`)
      .select('id')
    if (error) {
      console.error('[contacts] name write failed:', error.message)
      return 'failed'
    }
    return data && data.length ? 'written' : 'already-decided'
  } catch (err) {
    console.error('[contacts] name write threw:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}
