import { describe, it, expect } from 'vitest'
import { PERSONAS, personaOf, nameOf, portraitOf, hexToRgb } from './index'

describe('the ramp the canvas used to hold as literals', () => {
  // rudi-canvas.tsx carried these three RGB triples by hand. Moving them into the persona means the
  // conversion has to land on exactly the same numbers — a ramp that is one value off is a subtly
  // different portrait that nobody would think to check.
  it('converts to the same triples that were transcribed by hand', () => {
    expect(PERSONAS.rudi.ramp!.map(hexToRgb)).toEqual([
      [34, 211, 238],
      [139, 92, 246],
      [255, 46, 147],
    ])
  })

  it('spaces the stops evenly, as the three-stop ramp always did', () => {
    const ramp = PERSONAS.rudi.ramp!
    expect(ramp.map((_, i, all) => i / (all.length - 1))).toEqual([0, 0.5, 1])
  })
})

describe('Miles’s tokens', () => {
  // Written down so a later tidy-up cannot drift them: these are the values the brief specified, and
  // acid means Miles the way magenta means "needs you".
  it('are exactly the ones specified', () => {
    expect(PERSONAS.miles).toMatchObject({
      accent: '#D9F224',
      ink: '#41490A',
      wash: '#F2FBB8',
      voice: 'aura-2-arcas-en',
    })
  })

  it('paints from the supplied assets', () => {
    expect(PERSONAS.miles.still).toBe('/v2/miles-still.webp')
    expect(PERSONAS.miles.video).toBe('/v2/miles-speaking.mp4')
    expect(PERSONAS.miles.nodes).toBe('/v2/miles-nodes.json')
    expect(portraitOf(PERSONAS.miles)).toBe('/v2/miles-still.webp')
  })

  it('stands on the acid its own photograph was shot against, not on the accent', () => {
    // A stage that is merely close to the photograph's background shows a seam at the image edge.
    expect(PERSONAS.miles.ground).toBe('#d5fb48')
    expect(PERSONAS.miles.ground).not.toBe(PERSONAS.miles.accent)
  })

  it('falls back to the avatar for an employee with no portrait', () => {
    expect(portraitOf({ ...PERSONAS.miles, still: null })).toBe('/avatars/arcas.png')
  })
})

describe('personaOf', () => {
  it('reads the row', () => expect(personaOf({ persona: 'miles' }).key).toBe('miles'))

  it('treats an agent with no persona column as Rudi — every agent that predates it was the phone', () => {
    expect(personaOf({}).key).toBe('rudi')
    expect(personaOf(null).key).toBe('rudi')
    expect(personaOf({ persona: null }).key).toBe('rudi')
  })

  it('does not trust an unknown value', () => expect(personaOf({ persona: 'nova' }).key).toBe('rudi'))
})

describe('nameOf', () => {
  it('prefers the row’s own name — Miles is renameable exactly as Rudi is', () =>
    expect(nameOf({ name: 'Jordan', persona: 'miles' })).toBe('Jordan'))

  it('falls back to the persona default when the row has none', () => {
    expect(nameOf({ name: '', persona: 'miles' })).toBe('Miles')
    expect(nameOf({ name: '   ', persona: 'rudi' })).toBe('Rudi')
    expect(nameOf(null)).toBe('Rudi')
  })
})
