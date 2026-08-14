# Miles — a second AI employee for messages

Read `DESIGN.md` and `OUTSTANDING.md` first.

This is a NEW FEATURE, not a design migration. It adds behaviour. Build it in
stages, commit each, and stop if a stage doesn't land clean.

---

## The reference mockups are in this folder — read them before building any UI

- **`miles-approvals.html`** — the lock-screen notification with the draft inside
  it, the grouped/stacked notification, and the three-group inbox with an inline
  expandable draft. Four screens, switchable by the buttons at the top.
- **`miles-inbox.html`** — the hero panel, the technical mic, the channel icons,
  the filter row, and how it all sits over the real inbox layout. Mobile and
  desktop.
- **`miles-voice-panel.html`** — the voice states and how the panel grows while
  he's talking.

They say "Nova" in the files. The agent is **Miles**.

**Take the CSS values directly rather than approximating.** The mic ring SVG, the
draft box and its left border, the notification card, the group label with its
fading rule, the amber tokens, the panel heights and their transition. Match the
layout, spacing, colour and interaction exactly. Do not reinterpret them.

---

## What it is

Miles is a second AI employee who owns **inbound messages** — Instagram DMs,
Facebook Messenger, SMS, email. Rudi keeps the phone.

Miles answers what he's allowed to, drafts what he isn't, and the owner approves
from a push notification.

- Voice: `aura-2-arcas-en`
- Name: Miles, editable the same way Rudi's is
- Persona colour: acid `#D9F224`, ink `#41490A`, wash `#F2FBB8`
- Held-draft colour: amber `#F5A524`, wash `#FEF3DC`, ink `#6B4708`
- Portrait and video: I'll supply them. Build against a placeholder and tell me
  the dimensions you need.

---

## STAGE 0 — MAPPING. Do this and stop. No code.

Read what exists today for: agents, inbound message handling per channel, any
notification path, and how channels bind to an agent. Produce a table of what
exists, what's missing, and what a second agent would collide with.

Two questions the table must answer explicitly:

1. Does the schema already allow more than one agent per tenant, or is that new?
2. Is there any push-notification infrastructure at all today, or is that new too?

I approve the table before anything is written.

---

## The autonomy rule — the core of this

Not a global toggle. Split by what the reply commits you to.

| Sends immediately | Drafts and waits |
|---|---|
| hours, location | any price or quote |
| availability | any date or delivery commitment |
| facts already in the knowledge base | complaints, refunds, compensation |
| booking inside an existing availability window | anything with no answer in the knowledge base |

This is a default classification, adjustable by **telling Miles in conversation**
("don't quote prices without me") — not by a settings form. The rule moves; the
form doesn't exist.

**A draft waits indefinitely.** No timeout, no auto-send, no holding message.
Nothing goes out in the owner's name without an explicit decision. Every held
draft shows how long it has waited.

---

## Notifications

The **full draft text goes in the notification** — never "you have a draft, open
the app". If the owner has to open the app to find out what he wrote, response
time collapses and the feature is pointless.

Three actions, approvable from the lock screen without opening anything:

- **Send**
- **Edit**
- **I'll handle it** — stops Miles replying on that thread at all. Without this,
  every rejection becomes an edit.

Several within a few minutes arrive as **one grouped notification**, not several
buzzes. Approving the top one advances to the next.

**No quiet hours.** Notifications arrive whenever they arrive.

---

## Inbox — three groups, three states

| Group | Colour | Meaning |
|---|---|---|
| `WAITING ON YOU` | amber | Draft ready, held. Tapping expands it inline with the same three actions and "Held since 9:41. Nothing goes out until you decide." |
| `NEEDS YOU` | magenta | Miles had no answer and wrote nothing |
| `MILES HANDLED` | acid | Already sent, showing the **exact text** that went out |

That last point is not optional. A row saying "handled" without the words that
were sent in the owner's name is what would destroy trust in this feature.

---

## The panel

Miles gets a **hero panel at the top of the Inbox**, not a floating button — he's
an employee, not a help widget. Portrait, ON DUTY pill, and one true line: how
many sent, how many drafts waiting, how many need you. Silent when there's nothing.

**Voice-first.** A mic control opens a live conversation — the owner speaks, Miles
answers aloud, the panel grows while he talks and settles when he stops. Reuse
`useTestAi`'s state machine rather than writing a second one. Typing is the
fallback, not the primary path.

The mic is technical, not a toy glyph: concentric rings with signal bars, rounded
square, dark glass. Rings ripple cyan while listening, acid while speaking. The
exact SVG is in the mockups.

Desktop: he holds a permanent third column beside the threads.

---

## Design

Same language as everything else — `.v2-group`, `.v2-gcard`, `.v2-grow`,
`.v2-gchip`, `.v2-glab`, `.v2-stagger`, `usePressState`, and the six shared
controls. Channel icons in brand colour (Instagram, Facebook, SMS, email) both in
the filter row and on each thread.

**Acid is Miles's colour and appears only where he is.** It does not enter
navigation — that stays magenta. **Amber is new and means one thing only:** held,
waiting on you.

Reuse the persona work if it exists; if not, **persona becomes data now** — one
map holding name, portrait, ground, accent, voice. Rudi and Miles both read from
it. The hero engine, canvas and scan sweep must work identically for both.

---

## Order

**Stage 0 mapping first, and stop.**

Then one commit each, in this order:

1. Persona as data + the Miles record
2. The autonomy classifier and the draft state
3. The three-group inbox with inline approve
4. Notifications with actions
5. The panel and voice

Gates green and push after each. Never carry two unlanded.
