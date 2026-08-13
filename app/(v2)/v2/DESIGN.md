# /v2 — the design brief

Reread this at the start of every session before touching a screen. It is the standard the hero was
built to, and every other screen is held to the same one.

**Design every screen as if you were Higgsfield's lead designer. Same hand as the hero, on every page.**

## Surface

- Ink on light grey `#F2F2F5`. White cards, 16px radius, hairline border, single-pixel shadow.
  **Never a box inside a box.**
- Generous space. A dense screen is a wrong screen.

## Type

- **Inter Tight** for anything a person reads.
- **JetBrains Mono** only for labels, times and figures — never for prose.
- Figures large, their labels small and mono underneath.

## Colour

- **ONE accent**: the magenta → violet → cyan gradient, marking the thing that needs the person's
  action. If a screen has two gradients, one is wrong.
- Channel colour comes from `channels.ts`, everywhere a channel appears — the list mark, the detail
  chip, the thread. One mapping, never a second table.

## Writing

- One plain-language opening line per screen, built from that screen's **own real numbers**. Never a
  bare title. Say what happened, not what the table is called: "Three quotes are waiting on a
  customer" beats "Quotes".
- Empty states say what it *means*. "Nothing is waiting on you", not "No data" — and the goal state
  should read like one.
- **Missing is an em dash.** A metric that does not exist is omitted, not zeroed. Never invent a figure
  to fill a slot.

## Two things are always wrong

1. A screen that looks like the old app with new colours.
2. A control that exists because the layout had a gap.

## And the rules that are not about design

Reskin only — same behaviour as the existing screen, new look. No new queries: reuse the page's own
loader, extracting it verbatim into `lib/` if it is inline. Read-only, with every action rendered and
disabled at `title="v2 preview"`. Module-gated exactly as `/dashboard` gates it. **No server route may
call a value imported from a `'use client'` module** — see `channels.ts`. Gates as the last action
before each commit.

If a screen genuinely does not fit the shared components, say what field is missing rather than
bending them. That is how `ListPage`, `DetailPage` and `ThreadView` got their shape, and it is what
keeps fourteen screens looking like one product.
