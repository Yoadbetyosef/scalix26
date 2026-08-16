import { effectiveModules, enabledModulesOf, type ModuleKey, type ModuleState } from '@/lib/modules'

// WHAT THE PHONE AI IS ALLOWED TO DO.
//
// The text pipeline omits a tool the tenant has not enabled — `inBooking` requires `scheduling`,
// `catalogEnabled` requires `inventory` — so the model cannot offer what it cannot do. voice-server
// had no such idea: it offered every function to every tenant, and a business with `scheduling` off
// had a silent text AI and a phone AI still taking bookings.
//
// This is the list the TwiML handler computes and passes down. voice-server filters its own function
// list against it, exactly as it already filters `transfer_to_human` on `transferNumber` — the app
// decides, the server obeys. That precedent is why this is a parameter and not a second mechanism.
//
// ── CAPABILITIES, NOT MODULE KEYS ───────────────────────────────────────────────────────────────
//
// `booking`, not `scheduling`. voice-server has no business learning the module vocabulary: it knows
// its own functions and nothing else, so the two deployments cannot drift on a name. If a module is
// ever renamed or split, this file absorbs it and the WebSocket contract is unchanged.
//
// ── AN ABSENT PARAMETER MEANS EVERYTHING ON ─────────────────────────────────────────────────────
//
// The two halves deploy separately and in either order, and neither order may cost a tenant their
// booking:
//
//   app first          → an older voice-server ignores a parameter it does not read. Unchanged.
//   voice-server first → no parameter arrives, `ALL_VOICE_CAPABILITIES` applies. Unchanged.
//
// It is also the rule `enabledModulesOf()` already uses for a null column: absence means "nobody has
// said", and the safe reading of that is everything, not nothing. Encoded once, here, so both sides
// cannot disagree about it.

export const VOICE_CAPABILITIES = ['booking', 'catalog', 'payments'] as const
export type VoiceCapability = (typeof VOICE_CAPABILITIES)[number]

/** Every capability, which is what an absent or empty parameter must be read as. */
export const ALL_VOICE_CAPABILITIES: VoiceCapability[] = [...VOICE_CAPABILITIES]

/** Which module each capability needs. `transfer_to_human` is NOT here — it is gated on the agent's
 *  own transfer number, which is a different fact and already works. */
const NEEDS: Record<VoiceCapability, ModuleKey> = {
  booking: 'scheduling',
  catalog: 'inventory',
  payments: 'payments',
}

/**
 * The capabilities this tenant's phone AI may use.
 *
 * Goes through `effectiveModules()` rather than reading `enabled_modules` directly, so the platform
 * flag layer — disabled / beta / enterprise — governs voice the same way it governs every screen. A
 * module switched off platform-wide must not stay live on the phone.
 */
export function voiceCapabilities(
  tenant: { enabled_modules?: string[] | null; tags?: string[] | null } | null | undefined,
  flags: Partial<Record<ModuleKey, ModuleState>> | null | undefined,
): VoiceCapability[] {
  const isEnterprise = Array.isArray(tenant?.tags) && tenant.tags.includes('Enterprise')
  const modules = effectiveModules(enabledModulesOf(tenant), flags, isEnterprise)
  return VOICE_CAPABILITIES.filter((c) => modules.includes(NEEDS[c]))
}

/** The wire form: a comma-separated list. Empty string is NOT "none" — see below. */
export const encodeCapabilities = (caps: VoiceCapability[]): string => caps.join(',')

/**
 * Read the wire form.
 *
 * An ABSENT parameter means everything. An EMPTY one means nothing — a tenant with all three modules
 * off is a real state and must be honoured, so the two cases have to stay distinguishable. That is
 * why the caller passes `undefined` for absent rather than `''`.
 */
export function decodeCapabilities(raw: string | null | undefined): VoiceCapability[] {
  if (raw === null || raw === undefined) return [...ALL_VOICE_CAPABILITIES]
  return raw.split(',').map((s) => s.trim()).filter((s): s is VoiceCapability =>
    (VOICE_CAPABILITIES as readonly string[]).includes(s))
}
