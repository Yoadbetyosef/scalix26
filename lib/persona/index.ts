// WHO AN AGENT IS, AS DATA.
//
// Rudi's identity used to be four module constants inside `rudi-canvas.tsx` and a name typed into a
// dozen strings. That is fine while there is one agent and wrong the moment there are two: a second
// employee would have meant a second canvas, a second set of constants, and two things that drift.
//
// So the persona is a record and the engine reads it. Name, voice, portrait, ground, accent — one map,
// both agents, and adding a third is a row rather than a component.
//
// ── WHY THIS FILE IS NOT A CLIENT MODULE ────────────────────────────────────────────────────────────
//
// The canvas is a client component and the provisioning path is a server route, and BOTH need these
// values. A value imported from a `'use client'` module reaches a server route as a client reference
// proxy, not the value — invisible to `tsc`, thrown at runtime. Pure data with no directive crosses
// both ways. Same reason `app/(v2)/v2/channels.ts` exists.

import type { AgentPersona } from '@/types'

/** The same union the row carries — declared once, in types, so the column and the map cannot drift. */
export type PersonaKey = AgentPersona

export interface Persona {
  key: PersonaKey
  /**
   * The DEFAULT name. `ai_employees.name` wins whenever it is set — a name is editable, and Miles's
   * is editable exactly the way Rudi's is. This is what a row is created with, not what it displays.
   */
  name: string
  /** One line for what this employee owns. Not decoration: it is why there are two of them. */
  owns: string
  /** Deepgram Aura model id. The only TTS vendor — the phone, the sandbox and the briefing all use it. */
  voice: string
  /** The `/avatars` still. Also the canvas's fallback when there is no portrait yet. */
  avatar: string
  /** Portrait for the hero canvas. Null = no portrait supplied yet; the canvas falls back to `avatar`. */
  still: string | null
  /** Speaking loop. Always optional — a missing video costs a texture, never a frame. */
  video: string | null
  /** The mesh, in the still's own pixel space. Null until there is a still to derive it from. */
  nodes: string | null
  /** The stage the portrait sits on. Matches --v2-stage for Rudi; the canvas cannot read a custom
   *  property, so the literal and the token have to move together. */
  ground: string
  /** THE hue that marks this employee, and only where they are. */
  accent: string
  /** Ink on `wash`. */
  ink: string
  /** The pale ground for accent-tinted surfaces. */
  wash: string
  /**
   * The canvas's three-stop ramp, portrait-dependent — it has to suit the face it paints. Absent
   * means "not specified yet", which is the honest state for an employee whose portrait has not
   * arrived. The engine must refuse to guess one rather than average two hues into a third.
   */
  ramp?: [string, string, string]
}

export const PERSONAS: Record<PersonaKey, Persona> = {
  // The existing employee. Every value here was already in the codebase; this file did not invent one.
  rudi: {
    key: 'rudi',
    name: 'Rudi',
    owns: 'the phone',
    voice: 'aura-2-asteria-en',
    avatar: '/avatars/asteria.png',
    still: '/v2/rudi-still.webp',
    video: '/v2/rudi-speaking.mp4',
    nodes: '/v2/rudi-nodes.json',
    ground: '#0d0d10',
    accent: '#FF2E93',
    ink: '#5A0033',
    wash: '#FFE6F2',
    ramp: ['#22D3EE', '#8B5CF6', '#FF2E93'],
  },
  // The second employee: inbound messages — Instagram, Messenger, SMS, email. Rudi keeps the phone.
  miles: {
    key: 'miles',
    name: 'Miles',
    owns: 'inbound messages',
    voice: 'aura-2-arcas-en',
    avatar: '/avatars/arcas.png',
    still: '/v2/miles-still.webp',      // 680x907, same framing as Rudi's
    video: '/v2/miles-speaking.mp4',    // 612x816, same as Rudi's
    // 900 points, generated from the portrait by weighting each pixel by its distance from the
    // photograph's own background — so the mesh sits on him and never on the ground behind him.
    nodes: '/v2/miles-nodes.json',
    // MEASURED FROM THE FILE, not taken from the brief. The portrait was shot against acid, and the
    // stage has to be that exact acid or there is a visible seam where the image ends. #D5FB48 is
    // what the corners of the photograph actually are; #D9F224 below is his ACCENT, which is a
    // different job — it marks where he is, and it never has to match a photograph.
    ground: '#d5fb48',
    accent: '#D9F224',
    ink: '#41490A',
    wash: '#F2FBB8',
    // Rudi's ramp ends on pink. Miles's ends on his own acid, and starts on the cyan his mic ripples
    // while listening — the two colours the brief already gives him. The mesh is drawn over a dark
    // subject, so both read; over the acid ground it would not, which is why the mesh follows him.
    ramp: ['#22D3EE', '#8B5CF6', '#D9F224'],
  },
}

/** The canvas needs something to paint. The portrait when there is one, the avatar until then. */
export const portraitOf = (p: Persona): string => p.still ?? p.avatar

/** `#22D3EE` → `[34, 211, 238]`. The canvas interpolates in RGB; the map is written in hex like the
 *  rest of the design language, and one of the two has to convert. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/**
 * A row's persona. Unknown or absent → Rudi, because every agent that existed before this column did
 * was the phone agent, and the default has to be the one that is already true.
 */
export function personaOf(row: { persona?: string | null } | null | undefined): Persona {
  const key = row?.persona
  return key === 'miles' ? PERSONAS.miles : PERSONAS.rudi
}

/** The display name: the row's own, or the persona's default when the row has none. */
export function nameOf(row: { name?: string | null; persona?: string | null } | null | undefined): string {
  return row?.name?.trim() || personaOf(row).name
}
