import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { AURA_VOICES, DEFAULT_VOICE, isAuraVoice, auraVoice, voiceName, voiceHeadshot } from './voices'

describe('the catalogue', () => {
  it('offers the five Aura voices the picker has always shown', () => {
    expect(AURA_VOICES.map((v) => v.id)).toEqual([
      'aura-2-asteria-en',
      'aura-2-andromeda-en',
      'aura-2-thalia-en',
      'aura-2-odysseus-en',
      'aura-2-arcas-en',
    ])
  })

  it('has a headshot for every voice, by the naming rule the files follow', () => {
    for (const v of AURA_VOICES) expect(voiceHeadshot(v.name)).toBe(`/avatars/${v.name.toLowerCase()}.png`)
  })

  it('every offered voice is one the synthesiser will accept', () => {
    for (const v of AURA_VOICES) expect(isAuraVoice(v.id)).toBe(true)
  })
})

describe('auraVoice', () => {
  it('passes an Aura id through untouched', () =>
    expect(auraVoice('aura-2-arcas-en')).toBe('aura-2-arcas-en'))

  it('accepts the Spanish voices the phone path selects but the picker does not offer', () =>
    expect(auraVoice('aura-2-celeste-es')).toBe('aura-2-celeste-es'))

  // `^aura-2?-…` reads as "aura-1 or aura-2" and is not: the hyphen after `aura` is required, so
  // `aura-asteria-en` misses. Carried verbatim from /api/tts, where it has always been the rule, and
  // no agent is on an aura-1 voice (checked: all 25 production rows are aura-2). Written down because
  // the pattern looks like it permits something it does not.
  it('does not accept an aura-1 id, despite how the pattern reads', () =>
    expect(auraVoice('aura-asteria-en')).toBe(DEFAULT_VOICE))

  it('falls back rather than sending an upstream 400', () => {
    for (const bad of [null, undefined, '', '   ', 'nova', 'Daniel', 'aura-2-arcas', 'aura-2-arcas-fr']) {
      expect(auraVoice(bad)).toBe(DEFAULT_VOICE)
    }
  })

  it('refuses the four legacy ElevenLabs keys — the migration rewrites them, the code does not map them', () => {
    // Deliberate: a runtime map would mean two vocabularies coexisting forever, which is how the
    // sandbox ended up unable to speak a configured voice in the first place.
    for (const legacy of ['professional_female', 'professional_male', 'friendly_female', 'friendly_male']) {
      expect(isAuraVoice(legacy)).toBe(false)
      expect(auraVoice(legacy)).toBe(DEFAULT_VOICE)
    }
  })

  it('cannot be used to reach another host — the value is interpolated into the upstream URL', () => {
    for (const attack of ['aura-2-arcas-en&model=x', '../../evil', 'aura-2-arcas-en?x=1', 'https://evil.test/x']) {
      expect(auraVoice(attack)).toBe(DEFAULT_VOICE)
    }
  })
})

describe('voiceName', () => {
  it('names a known voice', () => expect(voiceName('aura-2-odysseus-en')).toBe('Odysseus'))
  it('shows the id itself for one the catalogue does not carry', () =>
    expect(voiceName('aura-2-celeste-es')).toBe('aura-2-celeste-es'))
  it('falls back to the default when there is nothing at all', () => expect(voiceName(null)).toBe(DEFAULT_VOICE))
})

describe('the migration and the code agree', () => {
  const sql = readFileSync(new URL('../supabase/migrations/normalise_voices_to_aura.sql', import.meta.url), 'utf8')

  it('rewrites every legacy value to a voice this module accepts', () => {
    const targets = [...sql.matchAll(/SET voice = '([^']+)'/g)].map((m) => m[1])
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) expect(isAuraVoice(t)).toBe(true)
  })

  it('leaves the column default on a voice this module accepts', () => {
    const dflt = sql.match(/ALTER COLUMN voice SET DEFAULT '([^']+)'/)?.[1]
    expect(dflt).toBe(DEFAULT_VOICE)
  })

  it('sweeps with the same shape the code validates with', () => {
    // If these two ever diverge, rows survive the migration that the runtime then refuses.
    const swept = sql.match(/voice !~ '([^']+)'/)?.[1]
    expect(swept).toBe('^aura-2?-[a-z]+-(en|es)$')
  })
})
