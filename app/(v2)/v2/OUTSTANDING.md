# /v2 — open threads

Kept here rather than in `lib/invoices/OUTSTANDING.md`: that file lives on
`feat/landed-cost-invoices` and does not exist on this branch, so writing to that path would
conflict on merge. Fold these in when the branches meet.

## 1. The canvas does not start until the first interaction — cause unidentified

**Status:** worked around, not fixed. `rudi-canvas.tsx` starts the render loop on the first
`pointermove` / `pointerdown` / `keydown` / `scroll`, one listener removed the moment any of them
fires. Until then she is a still frame.

**Established, and not worth re-investigating:**

- **The canvas is correct.** A cold-load log showed the ResizeObserver firing at +1ms with a real
  `contentRect`, the mesh built at +244ms from 900 points, the first canvas draw at 3ms, and
  `visible` / `onScreen` / `running` all true. It draws correctly and then stops mattering.
- **Nothing in `/v2` subscribes to `resize`.** `useMagnet`, `usePalette` and `Cursor` use `matchMedia`
  for `pointer: fine` and `prefers-reduced-motion` only. App-wide, the only other `resize` listener is
  `components/dev/overflow-diagnostic.tsx`, which is not mounted anywhere.
- **The render loop's effect has `[]` deps**, so a second `effect running` is a genuine unmount and
  remount, never a re-fired effect.
- **The trigger correlates with the `resize` event**, not with `blur` or `visibilitychange` — both of
  those fired alone and changed nothing. It reproduced on a *window* switch with the page visible
  throughout.

**What was tried and did not work:**

1. Seeding `onScreen` from `getBoundingClientRect()` at IntersectionObserver creation. `visible` and
   `onScreen` were both already correct at mount; this was a wrong theory, twice.
2. A `ResizeObserver` on the canvas calling `fit()` + `ensureNet()`. Correct in itself — `ensureNet()`
   bails on a zero width and previously had no way back — but it did not fix the reported symptom.
3. **The hoist** (`3dd09ba`): the hero moved to child 0 of `.v2-root` so it holds one position in both
   layouts and a branch change can no longer destroy it. Correct and worth keeping regardless — it
   also fixes real 720px crossings — but the cold load still did not run.

**The one candidate never ruled out:** `dataPromise` identity. If a new promise reaches `HomeClient`
on re-render, `use(p)` re-suspends and React can discard the subtree from the nearest boundary above.
It is created in a server component so a client-side resize should not produce a new one, but that is
an assumption, not a measurement. Log its identity in the render object before assuming anything else.

**Next step if it is picked up again:** log `dataPromise` identity per render, and check whether
`HomeClient` itself remounts (does `isMobile` return to `null`?) rather than only its children.

## 2. Contacts — DONE

All five list screens now run on the shared `ListPage`. The contacts read was extracted verbatim from
`app/contacts/page.tsx` into `lib/contacts/page-read.ts` (byte-identical, verified against the source
block) so both screens see the same window onto the address book.

## 3. Mobile lost its pinned composer in the hoist

`.v2-overlay` is now shared by both layouts, so mobile uses one composer rather than its own
`.v2-sticky` variant with `full`. `.v2-frame` and `.v2-ov` are unused. If the mobile composer should
be pinned to the bottom again, that is a rule on `.v2-overlay` inside the 720px media query — not a
second component.

## 4. Two-pane list — DONE

Above 1100px inbox, contacts and orders render the list beside the selected record; below it they are
one column and a row is a link again. The three detail routes were split into a `body.tsx` the route
and the pane both render, so a detail is one implementation reachable two ways. Leads and appointments
stay single column, since their rows route to a conversation or a contact rather than to a record of
their own.

## 5. Groups 2-4 are unbuilt

Rudi (AI Employees, Knowledge, Test AI), Business (Analytics, Reports), Account (Billing, Settings,
Partner Program, Admin). Each is a route, a loader — extracted verbatim into lib/ if it is inline —
and an href filled in on a destination nav.ts already lists. Knowledge's location is still
unconfirmed: there is no app/knowledge, so it is nested under ai-employees or settings.

## 6. Connection rows with no truthful state yet

The connections page carries only providers that can say something true about themselves. Left off
until they can:

- **Web chat** — no connection record found. It may be always-on rather than connected; if so the row
  is not a connection at all and belongs elsewhere.
- **Google Business** — a connect flow exists in onboarding, but no status is surfaced anywhere.
- **Pricing & services / Documents** ("so Rudi sounds like you") — these are catalog and knowledge
  CONTENT, not connections. The row would be "has content" rather than "is connected", which is a
  different kind of state and probably a different section.

A row that cannot say something true about its state does not belong on the page.

## 7. Sandbox vs phone voice divergence (pre-existing, NOT a migration regression)

Found while wiring the voice UI onto /v2/test-ai. Both faults predate the /v2 work; the migration only
made them visible by putting the two surfaces side by side.

- `/api/ai/speak` maps `ai_employees.voice` through `VOICE_MAP` to an **ElevenLabs** id. Aura ids
  (`aura-2-asteria-en`) are not keys in that map, so it silently falls back to the hardcoded default
  (Daniel, `speak/route.ts:26`). The sandbox never matches the configured voice.
- `voice === 'coo'` special-case at `speak/route.ts:29-31` overrides to Eric — a third voice.
- `/api/ai/speak` has no language concept; the phone path has `voiceLangConfig`, which branches to
  `SPANISH_AURA_VOICE` and injects a language prompt line.
- Two prompt builders: the sandbox uses `runAIPipeline`, the phone assembles its own Deepgram Voice
  Agent config in the Twilio webhook (the `catalogPromptLine` block, `voice/route.ts:301-318`).
  **Unconfirmed** whether they load the same playbook rows.

**Fix shape:** one `voiceFor(agent, surface)` resolver owning both directions and able to tell an Aura
id from an ElevenLabs one, rather than each route inferring; and one prompt builder with two surfaces.
Same pattern as the `getIntegrations` unification, and the same reason — two copies of one thing drift,
and this pair already has.

**Scope this as its own task, not part of the /v2 migration.** It touches the live voice path.

## 8. Connections rows blocked on a loader

Specified for /v2/connections, deferred because nothing can report their state and a design-only
migration does not authorise new reads:

- **QuickBooks state**, including the Sandbox badge
- **Google Business status** — the connect flow exists in onboarding; no status is surfaced
- **Twilio number pool** — `channels.twilio_number` exists per channel, but there is no pool view
- **A2P / brand status** — no field is read anywhere
- **Release Number** — an action rather than a state, and it lives on the agent endpoint

They ship when there is something true to say. Until then /v2/connections carries exactly the six
`getIntegrationStates` covers: calendar, outlook, twilio, email, facebook, instagram, stripe.

Related, from the same mapping: buying or releasing a number, choosing a Page and choosing a mailbox
all run through `/api/agents/:id/channels`. Connections shows their STATE; the binding stays on the
agent, because moving the connect action would mean changing agent endpoints inside a design-only
pass.
