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

/**
 * WHERE THE SCAN HAPPENS AND WHAT IT LOOKS LIKE, for one asset.
 *
 * x and r are fractions of the image WIDTH, y a fraction of its HEIGHT — image space, not canvas
 * space, and that is the whole point. In a prototype the frame and the source share an aspect exactly
 * and the distinction never surfaces; in the app the canvas is a phone, a laptop column or a 172x230
 * chip, and a canvas-space fraction would slide across the subject at every width.
 *
 * Every other number here is a multiple of the DOME RADIUS rather than of the viewport, for the same
 * reason: the scan is drawn around a thing in a photograph, and it has to keep its proportions to
 * that thing however the photograph is cropped.
 */
export interface DomeScan {
  x: number; y: number; r: number
  rings: number
  /** Where a ring starts, and how far it travels, as multiples of the dome radius. */
  from: number
  reach: number
  /** Alpha falloff exponent over a ring's life. 1 is linear; 2 fades early and lingers faint. */
  falloff: number
  /** Peak stroke alpha. */
  alpha: number
  /** Stroke width as a fraction of the dome radius. */
  stroke: number
  /** The stroke's gradient stops, as multiples of the ring radius. */
  inner: number
  outer: number
  /** The ring, at the near and far ends of its gradient. Equal makes a single-colour ring. */
  ink: [number, number, number]
  inkFar: [number, number, number]
  /** The bloom ON the glass — not a halo around it. Radii are multiples of the dome radius. */
  halo: { inner: number; outer: number; ink: [number, number, number]; alpha: number; swing: number; radPerS: number }
}

/**
 * One still, one clip, and everything measured off them.
 *
 * GROUPED ON PURPOSE. A width without its own dome is exactly how the phone's 0.684 / 0.349 came to
 * be applied to a desktop asset that wants 0.5845 / 0.3322 — six per cent low and two per cent left,
 * on a picture nobody had measured. These move together or they are wrong together.
 */
export interface AssetSet {
  still: string
  /** Null when this employee has no speaking loop at this size. A missing video costs a texture. */
  video: string | null
  /** The source's own pixel size, which the canvas cover-fits against. */
  width: number
  height: number
  /** Present = the scan is rings from here. Absent = the older sweep-and-mesh, for a portrait. */
  scan?: DomeScan
}

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
  /** The mesh, in the still's own pixel space. Null until there is a still to derive it from. */
  nodes: string | null
  /**
   * THE ASSETS, KEYED BY BREAKPOINT — and everything measured off each one, with it.
   *
   * A persona is WHO the employee is: name, voice, accent, the wash their messages sit on. A
   * breakpoint is not a second employee, so this is a record inside the persona rather than a second
   * row in PERSONAS.
   *
   * `desktop` is optional and falls back to `mobile`, so an employee with one photograph carries one
   * set and nothing about them changes.
   */
  assets: { mobile: AssetSet; desktop?: AssetSet }
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
    // NO MESH. The wireframe, the grid, the blooms, the markers, the crosshair and the tick ring were
    // all things drawn ACROSS a face. Nothing is drawn across the machine now — the only thing that
    // moves is the part of him that is already a display.
    nodes: null,
    assets: {
      // THE PHONE. From docs/miles/robot-scan-C.html, extracted byte-identically — still and clip
      // aligned to within a pixel and sharing one robot-free plate, and a re-encode is what would
      // spend that.
      mobile: {
        still: '/v2/rudi-robot-still.jpg',
        video: '/v2/rudi-robot-speaking.mp4',
        width: 784,
        height: 1660,
        scan: {
          // The dome INCLUDING its rim, which is what the rings sit outside of. The dark glass core
          // alone measures 0.672 / 0.336 / 0.096 — inside this in every direction, which is the rim.
          x: 0.684, y: 0.349, r: 0.108,
          rings: 4, from: 1, reach: 1.5, falloff: 1, alpha: 0.34, stroke: 0.052,
          inner: 0.86, outer: 1,
          ink: [34, 211, 238], inkFar: [139, 92, 246],
          halo: { inner: 0, outer: 1.5, ink: [34, 211, 238], alpha: 0.1, swing: 0.06, radPerS: 10 / 4.4 },
        },
      },
      // THE DESKTOP HERO, from docs/miles/rudi-desktop-scan.html. Built at the hero's own aspect —
      // 1130/1210 = 0.934 against 710/760 = 0.934 — so cover-fit is a 1:1 fit and nothing is cropped.
      // The phone pair in a 710x760 box threw the sides away and scaled up what was left, which is
      // why the arm was cut off and the rest looked soft.
      desktop: {
        still: '/v2/rudi-robot-desktop-still.jpg',
        video: '/v2/rudi-robot-desktop-speaking.mp4',
        width: 1130,
        height: 1210,
        scan: {
          // MEASURED OFF THIS ASSET, not carried over: the phone's numbers put the dome 6% low and
          // 2% left of where it actually is here.
          x: 0.5845, y: 0.3322, r: 0.0978,
          // Three rings, thinner, stopping just outside the rim rather than travelling a dome and a
          // half out, and mostly white with a cyan cast rather than cyan itself.
          rings: 3, from: 1.03, reach: 0.62, falloff: 2, alpha: 0.55,
          // W*0.0022 in the reference, over a dome radius of 0.0978W — the same number, expressed
          // against the thing it is drawn around rather than against the viewport.
          stroke: 0.0225,
          inner: 0.955, outer: 1.02,
          ink: [190, 235, 245], inkFar: [190, 235, 245],
          // A bloom ON the glass rather than a ring of light around his head, and breathing slower.
          halo: { inner: 0.55, outer: 1.22, ink: [34, 211, 238], alpha: 0.05, swing: 0.04, radPerS: 7 / 4.4 },
        },
      },
    },
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
    // ONE SET, so nothing about him changed: `desktop` is absent and falls back to this.
    assets: {
      mobile: {
        still: '/v2/miles-still.webp',
        video: '/v2/miles-speaking.mp4',
        width: 680,
        height: 907,
        // No scan block, so the canvas gives him the sweep and the mesh he already had. He will need
        // a character from the same family as the robot eventually; one is not derived from a robot arm.
      },
    },
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

/** Which breakpoint's assets to paint. `desktop` falls back to `mobile` for an employee with one set. */
export type Breakpoint = 'mobile' | 'desktop'
export const assetsFor = (p: Persona, at: Breakpoint): AssetSet => p.assets[at] ?? p.assets.mobile

/** The canvas needs something to paint. The portrait when there is one, the avatar until then. */
export const portraitOf = (p: Persona, at: Breakpoint = 'mobile'): string => assetsFor(p, at).still || p.avatar

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
