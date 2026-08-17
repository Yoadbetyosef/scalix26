// WHAT AN IN-PERSON BOOKING MEANS FOR THIS BUSINESS.
//
// `meeting_kind` gives the agent a way to SAY whether the customer travels or we do. This decides
// which one it reaches for when nobody said — and getting that wrong is the whole bug: a jeweller's
// customer was asked for their home address because `on_site` was the silent default everywhere.
//
// ── THREE STATES, AND THE THIRD IS THE POINT ────────────────────────────────────────────────────
//
//   'on_site'      we travel to them
//   'at_business'  they come to us
//   null           WE DO NOT KNOW — so ask, once, and remember the answer
//
// Null does not mean "unset pending a sensible guess". Guessing is what produced the bug, and the
// guess was always `on_site` because every industry option in the product is a travelling trade.
//
// ── WHY `industry` CANNOT ANSWER IT ON ITS OWN ──────────────────────────────────────────────────
//
// It is a fixed ten-item list and all ten travel: HVAC, Plumbing, Electrical, Cleaning, Landscaping,
// Roofing, Pest Control, Handyman, Pool Service, Other. There is no jeweller, salon, clinic or
// studio on it. Measured on the live table: 13 of 33 tenants read 'Other' and 8 read null, and every
// business with this problem is in those two buckets. The appointment that surfaced it — an
// engagement-ring consultation — sits on a tenant whose industry reads 'HVAC'.
//
// So the derivation is used ONLY where it is genuinely decisive, and everywhere else the agent asks
// a question a customer can actually answer instead of a settings screen the owner never opens.

export type MeetingDefault = 'on_site' | 'at_business'

/**
 * Industries where the tradesperson travels, always. Every one of the product's own options except
 * 'Other', plus 'Locksmith', which reaches the column through a different door (the demo/brand path)
 * and is not on the select.
 *
 * Lower-cased and compared exactly. Deliberately NOT a substring or keyword match: 'Other' must fall
 * through to the question, and a fuzzy rule would eventually catch something it should not.
 */
export const TRAVELLING_TRADES: ReadonlySet<string> = new Set([
  'hvac', 'plumbing', 'electrical', 'cleaning', 'landscaping',
  'roofing', 'pest control', 'handyman', 'pool service', 'locksmith',
])

export interface TenantMeetingFacts {
  default_meeting_kind?: string | null
  industry?: string | null
}

/**
 * What this business means by an in-person booking, or null when nobody knows yet.
 *
 * The stored column ALWAYS wins, including when it disagrees with the industry — Smith Hvac reads
 * 'HVAC' and is set to 'at_business' on purpose, and a derivation that overrode it would make the
 * override invisible, which is the opposite of what an override is for.
 */
export function resolveMeetingDefault(tenant: TenantMeetingFacts | null | undefined): MeetingDefault | null {
  const stored = tenant?.default_meeting_kind
  if (stored === 'on_site' || stored === 'at_business') return stored
  const industry = (tenant?.industry ?? '').trim().toLowerCase()
  return TRAVELLING_TRADES.has(industry) ? 'on_site' : null
}

/**
 * The sentence appended to the agent's instructions.
 *
 * Written for BOTH agents from one place — the voice prompt and the text pipeline build their
 * prompts separately, and a rule stated in one of them is a rule that holds on one channel.
 *
 * The unknown case asks the customer rather than refusing to book. "Are you coming to us, or shall we
 * come to you?" is a question anybody can answer in a sentence; a missing setting is not.
 */
export function meetingDefaultInstruction(resolved: MeetingDefault | null): string {
  if (resolved === 'at_business') {
    return 'WHERE APPOINTMENTS HAPPEN: customers come TO YOU at your premises. When you book an ' +
      'in-person appointment use meeting_kind "at_business" and do NOT ask for their address — you ' +
      'are not travelling to them. Only ask for an address if the customer specifically asks you to ' +
      'come out to them, and then use "on_site".'
  }
  if (resolved === 'on_site') {
    return 'WHERE APPOINTMENTS HAPPEN: you travel TO THE CUSTOMER. When you book an in-person ' +
      'appointment use meeting_kind "on_site" and ask for the street address. If they will not give ' +
      'one, book anyway and say you will confirm it later — never refuse a booking over a missing address.'
  }
  return 'WHERE APPOINTMENTS HAPPEN: you do not know yet whether this business travels to customers ' +
    'or customers come to it. The FIRST time you book an in-person appointment, ask the customer ' +
    'plainly — "will you be coming to us, or would you like us to come to you?" — and use ' +
    'meeting_kind "at_business" if they are coming to you, "on_site" if you are going to them. Ask ' +
    'for a street address ONLY in the on_site case. Ask this once, naturally, as part of arranging ' +
    'the appointment; never make it sound like a form.'
}
