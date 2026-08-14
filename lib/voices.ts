// THE VOICE CATALOGUE — one vendor, one list.
//
// There were three copies of these five voices (voice-selector.tsx, voice-demo.tsx and a stale legacy
// list on the v2 agent screen) and a fourth, different vocabulary in the TTS routes: an ElevenLabs map
// keyed by `professional_female | professional_male | friendly_female | friendly_male`. Those four
// keys were the schema's DEFAULT, so real rows held them — and because an Aura id was not a key in
// that map, the sandbox silently fell back to a hardcoded ElevenLabs voice and could never speak the
// voice the agent was configured with.
//
// One vendor now. `ai_employees.voice` holds a Deepgram Aura model id and nothing else — the four
// legacy values were rewritten by normalise_voices_to_aura.sql, and the column default with them, so
// there is no legacy branch left in the code to keep in sync.
//
// No 'use client': the pickers are client components and the TTS routes are server ones, and both
// read this.

export interface Voice {
  id: string
  name: string
  gender: 'Female' | 'Male'
  description: string
}

export const AURA_VOICES: Voice[] = [
  { id: 'aura-2-asteria-en', name: 'Asteria', gender: 'Female', description: 'Warm & friendly' },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', gender: 'Female', description: 'Professional & clear' },
  { id: 'aura-2-thalia-en', name: 'Thalia', gender: 'Female', description: 'Energetic & bright' },
  { id: 'aura-2-odysseus-en', name: 'Odysseus', gender: 'Male', description: 'Deep & professional' },
  { id: 'aura-2-arcas-en', name: 'Arcas', gender: 'Male', description: 'Natural & smooth' },
]

export const DEFAULT_VOICE = 'aura-2-asteria-en'

/**
 * Any Aura model id, including the Spanish ones the phone path selects (`aura-2-celeste-es`) which are
 * not offered in the picker. The shape is also the injection guard: this value is interpolated into
 * the upstream URL, so it is matched rather than escaped.
 */
const AURA_ID = /^aura-2?-[a-z]+-(en|es)$/

export const isAuraVoice = (v: string | null | undefined): boolean => !!v && AURA_ID.test(v)

/**
 * The voice to actually synthesise with. Anything that is not an Aura id — an empty column, a value
 * from a restored pre-migration dump, a typo — becomes the default rather than an upstream 400.
 */
export const auraVoice = (v: string | null | undefined): string => (isAuraVoice(v) ? v! : DEFAULT_VOICE)

/** The picker's label for a voice; the id itself when it is one of the Spanish voices or unknown. */
export const voiceName = (v: string | null | undefined): string =>
  AURA_VOICES.find((x) => x.id === v)?.name ?? (v || DEFAULT_VOICE)

/** Real photorealistic headshot per voice, e.g. /avatars/asteria.png. */
export const voiceHeadshot = (name: string): string => `/avatars/${name.toLowerCase()}.png`
