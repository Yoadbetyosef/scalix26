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
  /**
   * The pixel size of `still` and `video`, which the canvas cover-fits against.
   *
   * These were two module constants in rudi-canvas — 680 x 907 — shared by both employees, which was
   * true only because both portraits happened to be shot to the same frame. The moment one of them
   * stops being a head-and-shoulders it is false, and silently: the cover fit still produces a
   * picture, just the wrong crop of it.
   */
  width: number
  height: number
  /**
   * WHERE THE SCAN HAPPENS, in the still's own space — x and r as fractions of the image WIDTH, y as a
   * fraction of its HEIGHT.
   *
   * Image space, not canvas space, and that is the whole point. In the reference prototype the phone
   * and the source share an aspect ratio exactly, so a fraction of one is a fraction of the other and
   * the distinction never surfaces. In the app the canvas is any shape — a phone, a laptop column, a
   * 172x230 chip — and a canvas-space fraction would slide across the subject at every breakpoint.
   * The canvas maps these through its own DX/DY/S.
   *
   * Present means the scan is RINGS leaving this point. Absent means the older sweep-and-mesh, which
   * is what an employee whose portrait is a face still gets.
   */
  dome?: { x: number; y: number; r: number }
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
    // THE ROBOT. Extracted byte-identically from docs/miles/robot-scan-C.html — the still and the clip
    // are aligned to each other to within a pixel and share one robot-free plate, and a re-encode is
    // what would spend that. Verified rather than assumed: 1.0px across, 0.5px down between the still
    // and the clip's first frame, and three background strips differing by half a grey level.
    still: '/v2/rudi-robot-still.jpg',
    video: '/v2/rudi-robot-speaking.mp4',
    // NO MESH. The wireframe, the grid, the blooms, the markers, the crosshair and the tick ring were
    // all things drawn ACROSS a face. Nothing is drawn across the machine now — the only thing that
    // moves is the part of him that is already a display.
    nodes: null,
    width: 784,
    height: 1660,
    // Measured off the dome including its rim, which is what the rings have to sit outside of. A
    // measurement of the dark glass core alone comes out at 0.672 / 0.336 / 0.096 — inside this in
    // every direction, which is the rim.
    dome: { x: 0.684, y: 0.349, r: 0.108 },
    ground: '#0d0d10',
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
    // Still a photograph of a person, still on the sweep-and-mesh loop, and deliberately so: he will
    // need a character from the same family as the robot eventually, and one is not derived from a
    // robot arm. No `dome`, so the canvas gives him the scan he already had.
    width: 680,
    height: 907,
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
