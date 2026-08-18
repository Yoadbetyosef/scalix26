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
  /**
   * The pale ground this employee's own messages sit on, and the ink that reads on it.
   *
   * ── HAND-PICKED. DO NOT REPLACE WITH A FORMULA. ──────────────────────────────────────────────────
   *
   * The obvious tidy-up is `accent at 9%`, and it is wrong. Magenta at 9% on white is a clean blush;
   * acid yellow at 9% is a murky stain. The SAME rule produces two very different results, because
   * the accents differ in luminance far more than in saturation — and a thread with both employees in
   * it shows it immediately: one bubble looks designed and the other looks dirty.
   *
   * So each pair is chosen by eye, shifted and lightened until it reads at the SAME WEIGHT as the
   * others rather than at the same percentage. Acid becomes a soft citrus rather than a stain.
   *
   * A new persona needs its own pair, judged next to these two and not on its own. It costs one more
   * value in this map and buys a thread where every employee looks deliberate.
   */
  wash: string
  washInk: string
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
    // 784×1660 — the phone frame's own ratio, so `object-fit: cover` neither crops her nor
    // letterboxes the field. NOT the 680×907 the legacy loop assumes; see rudi-scan.tsx.
    still: '/v2/rudi-still.webp',
    // Framed to match the still exactly — same head size, same crown height, same field colour — so
    // the crossfade at the moment she starts speaking has nothing to jump.
    video: '/v2/rudi-speaking.mp4',
    // NO MESH. The scan replaced the node network, and rudi-nodes.json went with it — see
    // lib/invoices/OUTSTANDING.md §11. Miles keeps his, because he keeps the loop that draws it.
    nodes: null,
    ground: '#a1a3a4',
    accent: '#FF2E93',
    wash: '#FFEDF6',
    washInk: '#B0126A',
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
    // Not #F2FBB8 (the acid at a flat percentage) — that is the murky one. See `wash` above.
    wash: '#F4FAD5',
    washInk: '#5E6D0C',
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
