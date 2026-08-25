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

## 4. Two-pane list — DONE for contacts and orders; the INBOX GAVE IT UP

Above 1100px contacts and orders render the list beside the selected record; below it they are
one column and a row is a link again.

**The inbox no longer has a pane.** It became the three-group screen (see §18), whose rows navigate to
the conversation route rather than selecting into a right-hand pane. That is a real loss on a wide
screen — the record used to open beside the list — and it is the price of sorting by what a thread
NEEDS rather than listing everything. If it should come back, the pane belongs beside the groups, and
`/v2/inbox/[id]/body.tsx` still exists and is still the one implementation. The three detail routes were split into a `body.tsx` the route
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

## 7. Sandbox vs phone voice divergence — DONE, by deleting a vendor rather than resolving one

Fixed as Miles Stage 2. The plan had been a `voiceFor(agent, surface)` resolver able to tell an Aura
id from an ElevenLabs one; the better answer was that there is nothing to resolve. `/api/tts` had been
serving every phone call from Deepgram Aura all along, and a live check showed Aura covers everything
the sandbox route needed — `aura-2-arcas-en` returns 200 `audio/mpeg`, the only limit being 2000
characters (verified: 2100 returns 413), where the route already sliced at 900.

So: one `speakAura()` in `lib/deepgram/speak.ts` behind all three surfaces, one catalogue in
`lib/voices.ts`, `/api/ai/preview-voice` deleted (it had no callers — both pickers had already moved
to `/api/tts`), the dead `voice === 'coo'` branch deleted, and the four legacy ElevenLabs values
rewritten in the database by `normalise_voices_to_aura.sql` so no legacy branch survives in code.

**What did change for a person:** the Business Brain briefing speaks in `aura-2-arcas-en` instead of
an ElevenLabs voice with expressive settings Aura has no equivalent for. A deliberate trade — a
character change to a cached briefing against deleting a vendor.

What remains from the original item is the *prompt* half, untouched and still true: the sandbox builds
its prompt through `runAIPipeline` while the phone assembles its own Deepgram Voice Agent config in
the Twilio webhook, and it is **unconfirmed** whether they load the same playbook rows. One vendor did
not make that one prompt builder.

### The original entry, for the record

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

**Fix shape (superseded):** a `voiceFor(agent, surface)` resolver owning both directions. The vendor
was deleted instead — a resolver between two vendors is only worth building if you are keeping both.

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

## 9. The agent screen: two sections are read-only, and one header does not exist

**Skills and Knowledge Base render as summaries on /v2/agents/[id].** Both are edited by their own
components on the real screen — Skills by its own panel, Knowledge by `KnowledgeBaseEditor` — and
wiring those is not a reskin of the agent screen; it is those components' own migration. The v2
sections state what is on and how much is taught, which is true and useful, and stop there.

**There is no SCALIX PLAYBOOK header to preserve.** It was specified as read-only on Custom
Instructions, but `app/ai-employees/[id]` renders `system_prompt` as a plain textarea with no header,
prefix or read-only region anywhere. Adding one would be inventing a control, so Custom Instructions
is the textarea it has always been. If the playbook header is wanted, it is a new feature on the real
screen first.

**Facebook and Instagram rows show a Page id, not a Page name.** `Channel` carries `meta_page_id` and
nothing else; a name would be a new read.

## 10. The tenant Settings screen — DONE

/v2/settings ships the four sections from the approved mapping — missed-call capture, the booking link,
plan and the billing portal — over `readSettings` and `useSettings`, both extracted verbatim. In
operator mode plan and portal are ABSENT rather than disabled, from
`getActiveWorkspace().mode === 'operator'`.

The Settings row is live in nav.ts. Knowledge and Billing stay inert for a different reason: neither
has a route to reach at all. Billing exists only as `app/admin/billing`, `app/admin/wl-billing` and
`app/partner/(app)/billing` — all admin or partner planes, none tenant-facing.

## 11. There is no push notification infrastructure, and Miles is not building it

Established by the Stage 0 mapping and worth writing down so it is not re-litigated: this codebase has
**no** service worker, no `manifest.json`, no VAPID keys, no `web-push`, no FCM/APNs, no device-token
table and no mobile app. `lib/dashboard/attention-store.ts` is a client store persisted to
`localStorage`, so it is per-browser and cannot back a notification.

**Decision:** Miles's approvals ride the paths that exist — `sendSMS` / `sendEmail` carrying the full
draft text, and the tokenized public page pattern from `app/approval/[token]` + `lib/orders/approval-token.ts`
for Send / Edit / I'll handle it without logging in. The lock-screen experience the mockups draw is
what a real push implementation would render; the token page is the same three actions reachable from
the same message.

**Real push is a separate project**, and it starts with a PWA manifest and a subscription table.

## 12. The single-active-agent fault was NINE sites, not seven

The Stage 0 table listed seven `.eq('tenant_id', …).eq('status','active').maybeSingle()` sites. Two
more surfaced while fixing them, both unbounded, both worse than average:

- **`lib/twilio/provision.ts:144`** (`provisionTenantPhoneNumber`) — runs from the **Stripe checkout
  webhook**. A second active employee made it return null, so the tenant would pay and never receive a
  phone number, with a caught-and-logged error as the only trace.
- **`app/api/conversations/voice/route.ts:44`** — writes a conversation with no agent attached rather
  than failing loudly.

All nine now go through `primaryAgent()` in `lib/agents/primary.ts`: oldest ACTIVE agent, `.limit(1)`
before `.maybeSingle()` so PGRST116 is unreachable rather than unlikely. `lib/timezone.ts` was already
bounded and moved onto it anyway, so "the tenant's default agent" has exactly one implementation.

**The lesson worth keeping:** `maybeSingle()` reads like "0 or 1" and behaves like "exactly 1, or an
error you will mistake for an empty result". Any `maybeSingle()` without a `.limit(1)` above it is a
latent version of this bug.

## 13. Migrations — DONE

`add_miles_persona.sql` and `normalise_voices_to_aura.sql` are both run. `ELEVENLABS_API_KEY` is out
of Vercel, and the sandbox was verified in a browser speaking the agent's configured voice — the
symptom §7 existed for.

## 16. Miles Stage 3 is deliberately inert — nothing calls `hold()` yet

The classifier and the draft state exist; the interception does not. **No inbound path calls
`lib/miles/drafts.ts`**, so no message is held today and Miles changes nothing for anyone.

That is the sequencing, not an oversight. A held draft with no inbox group to see it and no
notification to carry it is a customer message that silently goes unanswered — strictly worse than
replying as Rudi always did. Interception lands with the surfaces that let a person act on it:

- **Stage 4** — the three inbox groups, so a held draft is visible with the three actions inline.
- **Stage 5** — SMS/email carrying the full draft text to the token page, so it reaches the owner
  when they are not in the app.

When it is wired, the call site needs all four of: the drafted reply, the inbound text, `grounded`
(from whether the reply actually used knowledge base / catalog / hours facts) and
`bookingWithinAvailability` (from the booking tools knowing the slot exists — never from the text
looking like a booking). `grounded` has **no default** on purpose: a caller that has not worked it out
must not inherit a convenient `true`.

Also unwired: `ai_employees.autonomy_rules` is read by the classifier but nothing writes it. Writing
it is Stage 6's job, because the rule moves by TELLING Miles — there is no settings form, by design.

## 18. The inbox and the messages screen were merged

`/v2/messages` existed for two stages so Miles could be built without deleting the reskinned inbox.
It is gone: `/v2/inbox` IS the three groups, with Miles's panel at the top, and calls sit in the
handled group beside the messages. The nav row went with it.

Two things follow from putting calls in that group:

- **The group is headed HANDLED, not "MILES HANDLED".** With two employees answering, one name over
  both is a small lie in the group heading. Each row names the employee who took it instead, and a
  call says it was a call.
- **A call never lands in NEEDS YOU.** Whoever spoke last on a phone call, the call is over; a caller
  is not sitting waiting for a reply to a transcript line. A call with no assistant line at all says
  "No transcript from this call" rather than quoting the caller back as though the agent had said it.

The panel counts only the rows the panel's own employee answered. The calls in that group are Rudi's.

## 17. Miles Stage 6 — what is built, and what is not

**Built:** the panel at the top of /v2/messages — the same canvas engine with `persona="miles"`, the
portrait/loop/mesh he was supplied, the ON DUTY pill, the one true line, and the mic with the ripple
the brief specifies (cyan hearing, acid talking). `useTestAi` takes an agent id now, so the panel talks
to Miles rather than to whoever answers the phone; it is still ONE state machine, projected onto the
canvas handle rather than reimplemented.

**The panel only renders when the tenant has hired Miles.** No Miles, no portrait and no ON DUTY pill
— a screen inventing a colleague is worse than a screen without one. `POST /api/agents/miles` hires
him, and the existing plan gate means Pro or better.

**Not built, and deliberately:**

- **The desktop third column.** The reference draws `206px | 1fr | 400px` with the panel in a permanent
  side column. This ships the panel at the TOP on both widths, which is the mobile reference exactly
  and a compromise on desktop. The third column is a layout change to the whole screen, not a panel
  change, and it should be done as its own pass.
- **Typing to Miles from the panel.** The brief calls typing the fallback; the mic is wired, the
  composer is not. `useTestAi` already exposes the chat half, so it is a control, not a mechanism.

**Unverified in a browser.** Types, tests and build are green and the assets are served (200,
`video/mp4`, `image/webp`), but nobody has watched the portrait paint, heard him speak, or seen the
panel grow while he talks. That needs a Pro tenant with Miles hired.

## 14. The partner BYO ElevenLabs field collects a credential nothing consumes

`KEY_PROVIDERS` (`lib/partner/integrations.ts:9`) accepts, encrypts, masks, verifies against
`api.elevenlabs.io/v1/user` and re-verifies an ElevenLabs API key. `partner_integrations.provider`
allows it at the schema level (`add_growth_os_7_wl_platform.sql:10`) and the Infrastructure screen
renders a field for it (`wholesale-infrastructure.tsx:17`).

**Nothing reads it back.** The only credential getter anything imports is `getPartnerTwilio`; there is
no `getPartnerElevenlabs`, and no synthesis path takes a partner key — the platform's own Deepgram key
serves every partner's tenants. So a partner is asked for a secret, told it verified, and it does
nothing.

Predates the vendor removal — it was already true when the platform used ElevenLabs, because even
then the TTS routes read `process.env`, never a partner's key.

**Two ways out, and they are genuinely different products:**

- **Drop it** — remove `'elevenlabs'` from `KEY_PROVIDERS` and the field from the screen. The provider
  stays in the CHECK constraint (dropping a value from a constraint means a migration and orphaned
  rows), and any stored key becomes inert data to purge. Smallest, honest.
- **Wire it** — a partner's own Deepgram/ElevenLabs key serving their own tenants' TTS. That is real
  wholesale infrastructure and it means a per-tenant vendor resolution in the synthesis path, which is
  the resolver §7 just deleted, back in a different place. Only worth it if partners actually want to
  bring their own voice vendor.

The same question hangs over `openai` in `KEY_PROVIDERS`, which is not checked here and probably has
the same answer.

## 15. Provisioning a number off a payment webhook cannot fail loudly

`app/api/webhooks/stripe/route.ts:120`, on `checkout.session.completed`:

```ts
provisionTenantPhoneNumber(session.metadata.tenantId).catch(err =>
  console.error('[provision] Failed to provision phone number:', err)
)
```

Three separate faults, and the Stage 1 fix addressed none of them — it removed one *cause*, not the
silence:

1. **The `.catch()` is mostly unreachable.** `provisionTenantPhoneNumber` and
   `provisionAgentPhoneNumber` RETURN NULL for the likely failures — no agent, no available number in
   any of the four search steps — and swallow their own errors internally
   (`trySearch` catches per step). A null return is not a rejection, so the handler logs nothing at
   all for the ordinary failure.
2. **It is not awaited.** Fire-and-forget in a serverless webhook: the response returns, and the work
   may be killed mid-flight. Nothing retries.
3. **Nobody is told.** No owner email, no admin alert, no row recording the attempt. The customer has
   paid; the product's first act is to silently not deliver the thing they bought.

**Fix shape:** await it, give it a result type (`{ok}` / `{failed, reason}`) rather than
`string | null`, and on failure notify — the owner and `lib/admin/notify.ts` — plus a record that
supports a retry. The webhook must still return 200 to Stripe; failing to provision is not a reason to
make Stripe replay the payment event.

**Do not fold this into a Miles stage.** It is a paid-conversion path and deserves its own commit and
its own verification.

---

## §19 — a text thread recapped while it was still open never gets rewritten

The recap is written once, at completion, and `recap_at` is the claim that keeps it once. The
backfill had to cover conversations that predate the feature, and 28 of them are text threads still
marked `open` — a genuinely live SMS or Instagram thread. Those were given a recap of where they
stood and had `recap_at` deliberately left null, so `writeRecap` can claim them again when they are
finally resolved, and the account gets rewritten with the ending in it.

That is right for the backfilled rows. It is NOT a general refresh: a conversation resolved once,
then reopened and continued, keeps the first recap forever. The claim sees `recap_at` set and stops.

**Fix shape:** clear `recap_at` when a conversation is reopened (`status: 'open'` on the status
route), so the next resolve writes a current one. One line, and it costs a second recap only on
threads that actually came back to life. Not done here because reopening is not wired in /v2 yet —
Resolve and Close are still `disabled` — so there is no way to reach the case from the new screen,
and doing it blind would be a rule nobody has watched run.

**Also:** nothing recaps a text thread that is simply abandoned. It stays open, so it never completes,
so the section stays empty on a conversation that is over in every sense but the column. A sweep
("no message in 30 days → resolved") would close that, and it is a product decision about when a
thread is finished, not a defect in the writer.

---

## §20 — a reply on Instagram, Messenger or email does not brake the drip

`stopDripsForPhone` ends a follow-up sequence when the customer answers. It matches by PHONE, because
`drip_campaigns` is keyed by `contact_phone` — so it covers SMS, WhatsApp and an answered call, which
is where every campaign on the live table lives. It cannot cover the channels that have no phone: a
customer who replies on Instagram, Messenger or by email keeps getting the SMS sequence.

**The second step, so it is not rediscovered:** match by CONTACT, not by number.
`drip_campaigns.lead_id → leads.contact_id` gives the person; every inbound path already resolves a
contact, and `conversations.contact_id` carries it. A helper taking `(tenantId, contactId)` would
cover every channel at once and make the phone match the fallback rather than the rule — worth doing
when a social or email lead source actually exists, which today it does not: all 28 campaigns came
from voice or a web form.

Phone matching is not a stopgap that should be replaced; it is the right key for the rows that exist.
The contact key is an ADDITION.

---

## §21 — one phone number has 21 drip campaigns

Every lead starts its own campaign and nothing dedupes them. On the live table: 28 campaigns across
**three** phone numbers — 21 on one, 6 on another, 1 on the third. Every call, every form submission,
every missed call from the same person opens another three-message sequence.

They have not overlapped yet only because the cron runs once daily and each sequence finishes before
the next lead arrives. Two active at once means that person is texted twice per send.

The brake blunts it — one reply stops ALL of a number's active campaigns, which is why the helper
updates every match rather than the first — but it does not stop them being created.

**Fix shape:** before inserting, stop any active campaign for the same contact, or don't create a
second one at all. Not folded into the brake because that commit is about ending a sequence somebody
answered, and this is about not starting a duplicate one. Deciding WHICH — supersede or skip — needs
a view on whether a returning customer should restart the follow-up clock, and that is a product
question rather than a defect.

---

## §22 — /v2/leads is gone; here is what it was and where each half went

Recorded because "why is there no leads screen" is a question somebody will ask, and the answer is
not "we forgot".

It listed one row per ARRIVAL: on the live table, twelve rows for four people, eleven of them
dismissed, one visible under "All". It answered *who arrived and from where*, which is not the
question an owner opens the product asking — and it could not answer *was anybody looked after*,
because its two live states were `new` and `contacted` and both mean "we sent something". `new` was
never even occupied: Speed-to-Lead moves a lead to `contacted` within seconds of creating it.

Every lead already manufactures an inbox thread, so the inbox is a strict superset in coverage and
answers the handled question properly, per thread, with the text quoted.

| what it carried | where it is now |
|---|---|
| `source` | conversation sidebar, "Came from", beside Channel |
| whether this person is NEW | the `new` chip on the inbox row — first conversation for that contact |
| Dismiss | "Stop follow-ups" on the conversation, named for what it does |
| Mark as Booked | deleted; derived from a confirmed appointment |
| `responded_at` | unchanged, in the table, feeding Impact |
| the counts | the home screen, from the inbox's own grouping |

**The `leads` TABLE is untouched and must stay that way.** Fifteen consumers read it — intake,
Speed-to-Lead, the drip anchor, Impact's response clock, the Brain, the learning harvest, the
playbook, the opportunity detector, customer recognition, Amy, Command Center, Partner OS — and none
of them ever read the screen. Removing the screen cost none of them anything.

**v1 still has its Leads tab** at /dashboard?tab=leads, and that is deliberate: it is where Dismiss
and Restore still live for anyone not on /v2. When v1 goes, Restore needs a home — it is the only
control of the four with nowhere else to be.

---

## §23 — the /v2 gate is an EXPOSURE boundary, not an authorization one

Read this before touching lib/v2/access.ts, because the fix for the other thing is much bigger and
somebody will otherwise find the file and build it.

**There was never a leak.** Every /v2 write was tenant-scoped before the gate existed and still is:
takeover, send and stop-followups go through `requireActiveBusinessContext()`, and the drafts route
through `getActiveTenantId()`. A signed-in user who typed `/v2/inbox` on the main domain could not
reach another business's data — the v2.* hostname is a REWRITE in proxy.ts, not a gate, so the path
always resolved, and the tenant scoping was doing its job the whole time.

**What they could do is use unfinished software on their OWN customers.** /v2 stopped being read-only
when the composer was wired: it now sends messages, stops follow-up sequences and marks leads booked.
That is what the gate is for. If it ever fails, the incident is "somebody saw an unfinished screen
and possibly texted their own customer from it" — not a breach, and not a reason to re-architect
tenant isolation, which is already correct.

**Identity is the TENANT** (`V2_TENANT_IDS`, empty by default = admins only), because the blast radius
of a /v2 write is one tenant's customer list, so the unit of the gate matches the unit of the risk.
It also composes with the operator plane for free: `getActiveTenantId()` returns the ACTIVE workspace,
so a partner switched into a client tenant is judged by that client's tenant rather than carrying /v2
into every workspace they operate.

**Two things the gate does not do, both deliberate:**

1. **A layout does not re-run on client-side navigation within /v2.** Entering the tree from anywhere
   outside renders it, so there is no way in that skips it — but access revoked mid-session survives
   until a reload. With an allowlist that only changes on deploy (which restarts everything) this is
   not reachable in practice. If the allowlist ever becomes a database row that changes at runtime,
   this stops being true and the check has to move.
2. **A layout does not cover route handlers.** The two /v2-ONLY endpoints carry the check themselves
   (`/api/miles/drafts/[id]`, `/api/conversations/[id]/stop-followups`). `/send` and `/takeover`
   deliberately do NOT: v1's inbox calls both, and gating them would break v1. This mirrors what the
   middleware already says about /admin — the layout gates the tree, and each API route gates itself.

**Not in the middleware**, for the reason the middleware itself gives about /admin: the check needs
the active tenant, which means cookies plus two Supabase reads, and the edge cannot do that.

---

## §24 — normalized_phone / normalized_email: make them load-bearing, or drop them

**Not this commit, and never written as ritual.** A column written by two paths and read by none is
how these got to 0/20 on the live tenant and stayed there.

Today: `createContact` and `commitImport` write both. **Nothing reads either.** `buildIndex`
re-normalises `phone`/`email` at read time, so the columns are decoration — and every contact on the
live tenant arrived through an AI or webhook insert that never sets them, which is why every one is
null.

The cost they were meant to remove is real: `loadExisting()` pulls **up to 10,000 contacts into
memory** on every create, every import preview, and every import commit, to build a Map.

**Either:**

1. **Load-bearing** — backfill both from `phone`/`email`, keep every writer current (create, import,
   the new edit route, and the AI/webhook inserts), switch `buildIndex` to read them, index them, and
   add a **partial unique index per tenant**. The duplicate rule then belongs to the database instead
   of to a race between two concurrent requests.
2. **Drop both columns.** Read-time normalisation is correct and already works; two unread columns
   that look like a mechanism are worse than none.

Whichever, it is its own commit. The edit route deliberately does NOT write them — adding a third
writer to a column nothing reads would just deepen the illusion.

---

## §25 — three contacts are one person, and merge is on another branch

On the live tenant, `+19174954300`, `(917) 495-4300` and `9174954300` are three contact rows with the
same ten digits. `createContact` and the import both refuse a duplicate on exactly this rule, so they
cannot have come from there — every one arrived through an AI or webhook insert, and **none of those
paths dedupes at all**. They find-or-create with `.eq('phone', phone)`, an exact string match, so a
number stored in a different format is a different person to them.

Correcting their NAMES is unblocked by the edit route. Consolidating the rows is not: retyping a
phone on any of the three 409s against the other two, which is the correct refusal and leaves the
owner with nowhere to go.

**Merge already exists** — `mergeContacts` + the atomic, idempotent `core_merge_contacts` RPC, with
a route at `app/api/core/contacts/[id]/merge` — on `scalix-core-platform-foundation`, **not merged
into this branch**. Do not write a second one. When that branch lands, the 409 from
`PATCH /api/contacts/[id]` is where merge gets offered, and no route needs to change.

**The deeper fix, when merge is available:** the AI/webhook insert paths should find-or-create on
normalised digits rather than an exact string (§24), or they will keep minting these.

---

## §26 — there is no owner-side "New appointment" — FIXED

`POST /api/appointments`, session-scoped, beside `/book` rather than inside it, sharing the insert
through lib/appointments/create.ts. One insert, two policies. The original entry follows.

### The original entry

The agenda header renders **New** disabled with a reason, deliberately, so the shape of the screen is
visible. It is not wired because there is nothing to wire it to.

`/api/appointments/book` is **public** and keyed by `lead_intake_token` — it is the AI's endpoint,
reachable without a session by design (it is in PUBLIC_ROUTES). An owner-side create cannot reuse it:
it would mean either handing the browser a lead token, or a second route.

**Fix shape:** a session-scoped `POST /api/appointments` taking `requireActiveBusinessContext()`,
sharing the slot validation, the 23505 double-booking guard, the calendar mirror and the
notifications with the existing route rather than restating them — most of that route's body is
already the shared part, and only the tenant resolution differs.

Its own feature, not a reskin. Named here so the disabled button is understood as pending rather than
forgotten.

---

## §27 — past and cancelled appointments no longer have a screen — FIXED

Fixed in the same round it was recorded. EARLIER runs below the agenda under its own day groups,
newest first, thirty days back, loaded by the SAME read — one query, split in memory. Cancelled rows
appear there and only there.

Not a filter chip, which was the other option and the wrong one: a chip that replaces the screen
hides today to show last week, and an agenda you can point backwards stops being an agenda. Days
simply continue downward in the direction time does.

A past row keeps its shape and loses its actions — there is nothing to move, and calling about a job
finished last week is a different intention that belongs on the contact. A gap on something that has
already happened is not counted in the opening line either: a number nobody can act on.

The original entry follows, for the reasoning.

### The original entry

## §27 (original) — past and cancelled appointments no longer have a screen

The agenda is today FORWARD, which is what an agenda is and what the reference draws — two day
groups, both in the future. The list this replaced had **Past** and **Cancelled** filters, so this is
a real loss, recorded rather than glossed.

Nothing is deleted and nothing is unreachable by other means: the rows are untouched, `/dashboard`'s
appointments tab still lists them, and Impact still counts them.

**Fix shape:** most likely NOT a filter chip on the agenda — an agenda that can be pointed backwards
stops being an agenda. More likely earlier days under their own heading below the upcoming ones,
using the same group form, loaded on demand. Worth deciding when somebody actually needs to look
something up, rather than guessing now.

---

## §28 — nothing tells a customer their appointment was cancelled

The move sheet's Cancel is wired: it PATCHes `status: 'cancelled'` and the slot frees up. The
reference's option says "They'll be told, and the slot frees up" — **the screen deliberately does not
say that half**, because nothing notifies the customer. Booking sends an SMS and an email; cancelling
sends nothing.

**Fix shape:** the confirmation path in `/api/appointments/book` already has the templates, the
partner billing gate and the fail-safe shape; a cancellation notice is the same call with different
words. The sentence goes back on the option the day it exists — the words and the behaviour ship
together or not at all.


---

## §29 — a walk-in with no phone number cannot be stored

`appointments.customer_phone` is **NOT NULL**. The owner's create form therefore requires a phone
number, and so does the route's schema — not a design decision, a column constraint that the form is
honestly reflecting rather than working around.

It is a real gap. An owner booking a walk-in, a neighbour, or somebody whose number they will get on
the day has nothing to type, and the appointment cannot exist.

**Fix shape:** make the column nullable and require *one of* name or phone at the route, the way
`createContact` already requires one of name/email/phone. The knock-on is small but real and must be
checked before the migration, not after — the review cron, the confirmation SMS and
`markLeadsBooked` all read `customer_phone`, and each needs to behave when it is absent rather than
send to an empty string.

Not this commit: it is a schema change with three readers behind it, and the form is usable without
it for every appointment that has a number — which today is all three in the database.

---

## §30 — voice-server does not gate on modules, and booking has no backstop — BUILT, ONE DEPLOY PENDING

The app side and both route gates are **shipped**. `voice-server/server.js` is **written and committed
but NOT DEPLOYED** — Railway auto-deploy is off, and it is the same manual deploy the landed-cost
merge is waiting on. One deploy, not two.

Until that deploy: the app sends the parameter, the running voice-server ignores a parameter it does
not read, and **the route gates still refuse** — so a tenant with `scheduling` off can no longer have
an appointment written, whatever the phone AI offers to do. The tool list is cosmetic until the
deploy; the hole that wrote rows is closed now.

The original entry follows.

### The original entry

The text pipeline omits a tool the tenant has not enabled: `inBooking` requires `scheduling`,
`catalogEnabled` requires `inventory`, the financial tools require the skill AND Stripe. The tool never
enters the request, so the model cannot offer what it cannot do.

`voice-server/server.js` has never heard of `enabled_modules`. It offers `check_availability`,
`book_appointment`, `search_catalog` and `send_payment_link` to every tenant. **A business with
`scheduling` off has a silent text AI and a phone AI still taking bookings.**

**Two holes, and they fail differently.** `/api/catalog/lookup` gates on `inventory` and the
payment-link route gates on the skill + Stripe Connect, so those fail gracefully at the route — the
model offers, calls, and is refused. **`/api/appointments/available` and `/api/appointments/book` have
no gate at all**, in the routes or in `lib/appointments/create.ts`. That one writes rows.

**The pattern already exists — do not invent a second one.** `transferNumber` is this exact problem
solved: the app passes a `<Parameter>`, and voice-server includes `transfer_to_human` only when it is
set. Copy that.

**Shape:**

| Where | Change |
|---|---|
| `/api/webhooks/twilio/voice` (Vercel) | It already loads the tenant and assembles per-call config. Add `effectiveModules()` — the same call listPageContext makes, so the global `module_flags` layer is honoured too — and emit one parameter |
| `voice-server/server.js` (SEPARATE deployment) | Read it into a Set; filter `agentFunctions` the way `transferNumber` already filters transfer. ~10 lines |
| the two appointment routes | The missing backstop. Refuse when `scheduling` is off, as `/api/catalog/lookup` does. **Do this regardless of the tool list** — a gate that lives only in the offered tools is one a curl walks around |

**Pass CAPABILITIES, not module keys** (`booking`, not `scheduling`), so voice-server never learns the
module vocabulary and the two deployments cannot drift on naming.

**Absent parameter must mean everything on**, matching `enabledModulesOf()`'s rule for a null column.
The two deploy separately and in either order; this is what makes both orders safe, with no window
where a tenant loses booking.

Verification is a phone call, not a test. And note: auto-deploy on the Railway voice-server is
**currently disabled** — the same manual deploy the landed-cost merge is waiting on.

---

## §31 — Reports is gated on `analytics` and shows four templates that produce nothing

`/v2/reports` and `/reports` list Platform Usage, AI Employee Productivity, Lead Generation and
Appointment Report. **No generator exists for any of them** — nothing anywhere reads a template id
except `app/reports/page.tsx:13`, to pick an icon and a Tailwind colour. v1's "View Report" and its
per-card download are `<Button>` elements with no `onClick`. The only real behaviour is a CSV of
CONVERSATIONS, over a date range, from `/api/reports/export` — one caller, no persistence, no
schedule, no consumer.

**It is gated on one module, and it should be derived from all of them.** The four names promise data
from four different sources, and which of those a tenant even has is a per-tenant fact: 28 of 33
tenants have no commerce module at all; 1 has `landed_cost`; 2 have `studio`. A locksmith with
`ai_voice, inbox, contacts` and YDC with ten modules cannot be shown the same screen truthfully.

**The shape this argues for:** one registry of `{ id, module, label, columns, read }`, filtered by
`effectiveModules()` — the same way `nav.ts` assembles the rail and the sheet from one list so the two
navigation surfaces cannot drift. Reports then IS whatever the tenant's modules provide, and a report
that has no data source behind it cannot be listed, because listing it would require writing one.

What is genuinely exportable today, measured: conversations, messages and appointments for every
tenant; plus product costs and orders where `commerce` is on. Contacts needs its conversation count
derived (`total_conversations` is 0 on every row); margin needs prices (7 of 211 on YDC); leads,
invoices and studio quotes need states that nothing currently sets.

---

## §32 — when a CRM push is built, the calendar mirror is the shape

Not now — it is a real project. Recorded so whoever builds it does not invent a second pattern.

There is **no outbound integration of any kind** today. `POST /api/leads/inbound/<token>` accepts leads
IN (a web form, Zapier, Make). The only thing that goes OUT is the Google/Microsoft calendar mirror in
`lib/appointments/create.ts`, and QuickBooks, which is connected and has never synced. A contact never
leaves at all. `connected_calendars` has **0 rows** — so in practice an appointment only ever lives
here.

**The calendar mirror is already the right shape**, and it is worth copying rather than redesigning:

- ONE call, after the row is written. The appointments row is the system of record.
- FAIL-SAFE: wrapped, logs a warning, and never affects the confirmed booking. A CRM being down must
  not cost the customer their appointment.
- Stores the EXTERNAL ID back on the row (`google_event_id`), which is what makes a later update or a
  reconciliation possible at all.
- Dispatches by provider behind one interface (`access.provider === 'microsoft' ? … : …`).

Its known limitation is also the one to fix in a CRM adapter, not repeat: **it is one-way and nothing
reads back**, so an appointment moved in the external system and the row here diverge silently.

Do NOT build it as a module toggle. Entitlements and interoperability are different problems —
turning `scheduling` off for a ServiceTitan tenant stops Rudi booking; it does not let Rudi book into
ServiceTitan, and nothing in the module system is a step toward that.

---

## §33 — invoice numbers are allocated at CREATION — DECIDED, keeping it

**Decided 16 Aug 2026, deliberately, while all four invoices were still drafts nobody had seen.**

Option 1 is **rejected and closed**. The number is drawn when the draft is created. A gap means a
draft was made and deleted, and that is the honest record of what happened. Reallocating at issue
would mean a draft carries no number until it is sent, which makes it harder to talk about
internally — and internal conversation about a document that does not exist yet is most of what a
draft is for.

This was the decision that had to be made before the first issued invoice reached a customer, because
after that the sequence would contain two eras of numbering with no way to tell them apart. It is
made. Nothing further is required.

**Option 2 stays open and stays cheap.** If an accountant ever asks why INV-0003 is missing, a void
log — a table, and a write on the path that deletes a draft — is the answer, and it costs the same
then as now because it is purely additive. Do not pre-build it.

The original entry follows, for the reasoning.

### The original entry

`createDocument` takes the number from `numbering_counters` when the DRAFT is made, atomically. It is
not allocated at issue. On the live tenant that has already produced a gap:

    INV-0001  19 Jul 01:53
    INV-0002  19 Jul 13:30
    INV-0004  20 Jul 02:54     ← INV-0003 exists nowhere
    INV-0005  20 Jul 05:42

A draft was created and deleted, or a number was drawn and the insert failed. The counter does not
give it back, which is correct for a counter and wrong for an audit trail: **in several jurisdictions
an issued-invoice sequence must be gapless**, and "0003 was a draft I threw away" is an explanation an
accountant should not have to accept.

Issuing deliberately does NOT reallocate. The four live invoices carry the numbers they were created
with, and renumbering them would break every reference anybody already holds.

**The two real options, both real changes:**

1. **Draft numbers become provisional** — a draft carries no number, or a `DRAFT-…` placeholder, and
   `issueDocument` draws from the counter. Gapless issued sequence; every existing row needs deciding.
2. **Keep it and record the gaps** — a deleted draft writes its number to a void log, so the sequence
   is explainable rather than merely gapped.

Not decided here because it is an accounting question with a jurisdiction in it, not a code
preference. Whoever picks must also decide what happens to INV-0001, -0002, -0004, -0005.

### WHICH IS CHEAPER TO ADD LATER — the thing not to get wrong

**Option 2 is cheap whenever you do it. Option 1 gets more expensive every day, and after the first
real issued invoice it stops being reversible.**

*Option 2 (void log)* is purely additive: a table, and a write on the path that deletes a draft.
It needs no existing row changed, no number reissued, and nothing in the UI to move. Adding it in six
months costs exactly what it costs today.

*Option 1 (allocate at issue)* is a change to what a number MEANS. Today the four invoices are all
drafts carrying numbers, so switching is a data question about four rows nobody has seen. Once any of
them is issued and sent, its number is in somebody else's records — and after that, moving to
allocate-at-issue leaves two eras of numbering in the same sequence, with no way to tell which era a
number came from without a column recording that too.

**So the decision that has to be made BEFORE the first issued invoice reaches a customer is option 1.
Option 2 can wait indefinitely.** If you are unsure, the safe order is: decide 1 now (even if the
answer is "keep allocate-at-creation"), and leave 2 until somebody actually asks why 0003 is missing.

Concretely: the first `POST /api/core/documents/invoice/{id}/issue` that is followed by sending the
document to a customer is the point of no return. Nothing in the code stops you today — this is a
note, not a guard, because a guard would be pretending the accounting answer is known.

---

## §34 — an issued document cannot be corrected, deliberately

`add_document_freeze.sql` blocks INSERT, UPDATE and DELETE on the lines of any document that is not a
draft, at the database. There is **no override, and that is a choice**: if an issued invoice is wrong,
the answer is a credit note or a replacement document, not editing history. Building an escape now
would make it the thing people reach for.

What does not exist yet, and will be wanted the first time somebody issues the wrong figure:

- **Void.** A status that says "this number was issued and is cancelled", so the number stays used and
  the sequence stays explainable. One status and one history row.
- **Credit note.** A negative document referencing the original. `payment_allocations` already carries
  a `refund` kind and stores it signed, so the money half exists; the document half does not.

Until one of them is built, the honest instruction to an owner is: issue carefully, because the only
correction available is a new document and a conversation.

---

## §36 — adding invoice lines is N+1, deliberately

`addLine` is one call per line, and each call is three queries: a `count` for `sort_order`, the
insert, then `recomputeTotals` (select every line, update the header). A five-line invoice is one
create plus fifteen queries, and the header total is recomputed five times with four results thrown
away.

**Not pre-solved, on purpose.** A bulk `addLines(array)` would be a SECOND write path into
`sales_document_lines`, and that table now has a trigger (`trg_lines_only_on_draft`) and a recompute
that both paths would have to keep in step. Fifteen queries on a form somebody fills in a few times a
day is nothing; two write paths that must agree about a freeze rule is a real cost, paid forever.

**The moment to revisit:** a fifty-line invoice, or an import that creates documents in bulk. Then the
bulk path is worth its own trigger-awareness, and it should recompute ONCE at the end rather than per
line.

Measured, so the number is not a guess: probed on the live database, three lines cost three inserts
and three header recomputes, and the header read correctly after each one.

---

## §37 — a send is recorded, not confirmed

`POST /api/core/documents/invoice/[id]/send` stamps `sent_at` and writes a `document_status_history`
row only after the provider ACCEPTED the message — `sendEmail` returns `{ success }` rather than
throwing, and a refused send is a 502 that stamps nothing. That is as far as the record goes.

What "sent" therefore means: **we handed it to Resend or Twilio and they took it.** It does not mean
delivered, and it certainly does not mean read. A hard bounce arrives later, on a webhook nobody is
listening to, and the invoice goes on saying "sent 3 days ago by email" to an address that does not
exist. The owner's next signal is silence, which they will read as the customer ignoring them.

Three things that do not exist and are each separable:

- **Bounce handling.** Resend posts `email.bounced`; `/api/webhooks` already receives provider posts.
  One handler, one column (`delivery_state`), and the sub-line can say "bounced" instead of "sent".
- **Reminders.** Nothing chases an overdue invoice. The detail screen says so out loud — "Nothing
  chases them automatically" — because an owner who assumes otherwise loses money quietly. The drip
  engine (`lib/leads/drip.ts`) is the shape this would take, and its brake (any inbound message ends a
  sequence) is the part that makes it safe.
- **Opened.** Deliberately not built. A tracking pixel on a document somebody is being asked to pay is
  a different product decision, not a feature gap.

The one thing already true: every send appends to history, so "when did they FIRST get this?" — the
question an owner is asked when a customer says they never received it — is answerable even though
`sent_at` has been overwritten by every reminder since.

---

## §38 — TG jewellers: two problems named and deliberately not fixed

Both surfaced while building the four fixes she asked for. Both are real, both
are bigger than the thing next to them, and neither is what she reported.

### 87 of 217 contacts have no name

Forty per cent. 83 of the 87 have an email and no phone, `channel` is `email` or
null, and the list includes `accounting@tg-designs.com`, `tatiana@tg-designs.com`,
`support@scalix26.com` and the platform owner's own address.

They are **inbound mail correspondents auto-promoted to contacts**. The v1 edit
form now shipped does not fix this and was never going to: she would be
hand-naming 87 rows, most of which should not be contacts at all.

**What would fix it** is a rule about which inbound addresses become contacts —
almost certainly "not our own domains, not the platform's" as a first cut — plus
a way to bulk-archive the ones already made. Both are decisions about her data,
not bugs, and both should be put to her rather than guessed.

### 12 of 15 orders have no `contact_id`

They store `customer_name` / `customer_email` / `customer_phone` as free text on
the order row instead. Only 3 of her 15 orders point at a contact record.

The consequence that matters for tax: **there is no path from a customer record
to a delivery province**. Every order's place of supply has to be picked by hand
because nothing can suggest one, and a customer who always ships to Ontario is
re-typed every time.

**What would fix it** is linking orders to contacts at creation, which changes
how an order is created — a separate design decision, and one that has to answer
what happens to the 12 orders already carrying free text that may not match any
contact.

## §20 — the cascade sweep stops at the rule boundary

`scripts/find-css-duplicates.mjs` and `app/css-duplicates.test.ts` now guard one
failure: the same property declared twice **inside one rule**, where the second
silently wins. That is the shape the `.v2-scrim` `transition` bug had — height
never animated for months because `transition: opacity 0.35s` sat two lines
below it — and the sweep that followed found exactly one other instance, the
dead `linear-gradient` fallback on `.v2-talk`, removed in the same commit. Both
files are clean and the test fails on reintroduction.

**What it does not cover** is the same fault one level out: two *different*
selectors of equal specificity both matching one element, where source order
alone decides the winner. `.v2-root[data-state="listening"] .v2-scrim` and
`.v2-root[data-state="armed"] .v2-scrim` are the benign version — deliberate,
mutually exclusive. The dangerous version looks identical in the text and can
only be told apart by knowing which elements actually exist in which state.

**Why it is not built.** It cannot be done by parsing text. It needs the rendered
DOM: enumerate the elements /v2 really produces in each state, ask the browser
which declarations won, and flag every property where a losing declaration came
from a rule of equal specificity. The headless harness could do it. The reason to
wait is the signal-to-noise ratio — most equal-specificity pairs are intentional,
so a first run would be mostly false positives, and triaging those is a day's
work that belongs after the visual pass, not in the middle of it.

Deferred deliberately, 2026-08-23, not forgotten.

## §21 — the Talk button's own label is 4.00:1, and always has been

Measured on the dev server at 390×844: the white label against the pill's own
gradient reads **4.00:1**, under the 4.5 that 14px/600 needs. It is not affected
by anything the scrim or the caption backdrop do — the pill carries its own
background, so it measured 4.00 before the veil was removed and 4.00 after.

**Left deliberately, 2026-08-23.** It is the most prominent object on the screen
by hue: saturated magenta-to-cyan on a neutral plate, with a coloured drop shadow,
at the one place the eye is being sent. Nobody has ever failed to find it. Raising
the ratio means darkening the gradient or weighting the label, and both change the
one piece of the composition that is working.

**What would change the answer** is a real report of somebody unable to read it,
or a decision to hold /v2 to AA across the board rather than where it matters. The
number is here so the next person finds a decision rather than an oversight.

## §22 — the /v2 caption does not meet AA at rest, on purpose

Measured on the dev server at 390×844, idle, with no veil and no backdrop:

| line | ground luma | vs white |
|---|---|---|
| 1 — "3 new people today, 1" | 163 | **2.52:1** |
| 2 — "handled. One thing needs" | 148 | 3.03:1 |
| 3 — "you." | 145 | 3.15:1 |

Floor 2.52:1 against the 4.5 that 31px/600 text needs. Lines 2 and 3 are painted
with the accent gradient rather than white, so their figures are the ground's
contribution and not their true contrast; line 1 is white and its 2.52 is real.

**What was tried.** A local backdrop behind the caption — a blurred box ramped to
sit under the three lines — reached floor 6.79:1 and spread 0.11, and it is in the
history at `ac4a604` if the numbers are ever wanted again. It was removed because
with no veil at rest it was the only dark thing on a light plate: it stopped
reading as the bottom of a gradient and started reading as a grey object laid on
the photograph. Before that, a full-width scrim carried the caption and produced a
visible horizontal edge under the readouts that three separate attempts failed to
soften — the frame has to be bright where the robot is and dark where the copy is,
with 43px between them, and that bands at any ramp.

**The decision, taken by Yoad on 2026-08-23:** the text is softer and the picture
is clean. Prominence is the reason the character became a robot, and a grey cloud
in the middle of the screen costs more than the contrast buys.

**Listening is unaffected and is fine** — the veil gives floor 8.06:1, spread 0.26.
The failure is idle only.

**What would change the answer** is anyone reporting they cannot read it on a real
phone in real light — this is measured on a synthetic render of one asset, and a
photograph with a darker lower third would score differently. Anything proposed
here has to answer the SHAPE problem first, not just the contrast one: a full-width
gradient bands, and a local box reads as an object.

## §23 — three defects /inbox's migration surfaced and did not fix

Found while finishing /inbox on 2026-08-24. None is /inbox's; all three are the
shell's, and the shell is Yoad's held item (b). Recorded so they are not
rediscovered page by page.

**~~The notification bell covers the contact-info button on a phone.~~ FIXED
2026-08-24.** The bell was `fixed right-3 top-8px`, 44x44 — exactly where a page
header puts its right-hand control, and /inbox/[id] put contact info at x336 y17,
38x38. Playwright could not tap it even with `force: true`; a person could not tap
it at all. Pre-existing — v1's button was in the same square.

Moved to bottom-right on mobile, the corner it already occupies on desktop and the
one no page header uses, clearing the 60px tab bar plus the safe area. Repositioned
rather than made to yield, because yielding is per-page and the next header control
to land in that corner would break it again silently.

Verified on the production build in a real touch context (`hasTouch`, `isMobile`,
no `force`): contact-info at [336,17,38,38] and the bell at [334,728,44,44] do not
intersect, a real tap on each opens the right thing, and the dashboard's Talk
button [108,714,175,54] ends 51px before the bell begins.

**Residual, and it is inherent:** a floating button over a scrolling list always
covers part of a row. On /inbox and /contacts the bell overlaps 44px of one
full-width row. That is not the same defect — the row is 390px wide and reachable
everywhere else, whereas the contact-info button had no other tap target at all.
The check that guards this now measures the difference: it fails only when the bell
covers a control under 120px wide or takes a quarter of one. The real answer is for
the bell to stop floating and live in the bottom bar, which is item (b)'s work.

**~~Two~~ ONE v1 class remains on every migrated page, AppShell's.** `rounded-xl`
came from the mobile bottom bar and went with it on 2026-08-24; `shadow-e2` from
the bell is what is left. The reporter now attributes them to the shell rather than to
whatever page happens to be under them — `<main>` is the page, everything else is
chrome. `/inbox`'s own column is empty; do not chase these on the next page.

**~~The mobile action bar sits under the bottom nav.~~ FIXED 2026-08-24 with (b).**
/inbox/[id] ends with a `md:hidden` Take Over / Resolve bar as its last flex
child, so it sits on the viewport's bottom edge, where v1's fixed tab bar covered
it. Replacing the bar with the swipe handle did NOT fix this on its own — the
handle is a 49px full-width strip in the same place and covered it just the same,
which a real tap confirmed. The handle now publishes its height as `--v2-grab-h`
and that bar clears it.

## §24 — /studio's card is not a link

`/studio/[id]` exists and nothing in the UI reaches it. Noted by Yoad on
2026-08-24 for the backlog, explicitly not to be fixed during the migration.

## §25 — order document views are permanently out of scope

The letterheads are print artefacts, not app screens. They are excluded from the
V2 migration for good, not deferred. Decided by Yoad, 2026-08-24.

## §26 — Leads: the UI is gone, the machine underneath is not

Removed from the product on 2026-08-24: the rail row, the Business group entry,
the dashboard tab, `components/dashboard/leads-table.tsx`, the `?from=leads`
back-links on /inbox/[id] and /contacts/[id], the `pipeline` module's nav
mapping, and the `leadLinks` query in `getDashboardData` — the only genuinely
dead query the removal found (it pulled every conversation belonging to any
lead's contact, ordered, so a table row could be clickable).

**`?tab=leads` no longer resolves.** An old bookmark falls back to Overview
rather than 404ing.

What is left, and why it was left — this is the inventory for the later delete
decision, not a to-do list:

**Routes, still live and still reachable by URL**
- `app/api/leads/inbound/route.ts` and `app/api/leads/inbound/[token]/route.ts`
  — inbound lead capture. These are how leads get IN. If a tenant has a web
  form or a partner integration pointed at either, deleting them silently drops
  customer enquiries. **Check before deleting.**
- `app/api/leads/[id]/route.ts` — the status PATCH (new / contacted / booked /
  called_back / dismissed). Nothing in the UI calls it now. Dismiss and Restore
  survive only here.

**The `leads` table has nineteen readers, and most are not "the Leads screen"**
`lib/leads/booked.ts` (an appointment marks its lead booked),
`lib/leads/speed-to-lead.ts` and `lib/leads/drip.ts` + `/api/drip/process`
(the follow-up engine, on a cron in vercel.json),
`lib/amy/snapshot.ts` and `lib/amy/sources/leads.ts` + `metrics.ts` (what the
voice agent knows), `lib/brain/engine.ts` and `view.ts` (Business Understanding),
`lib/command-center/adapters.ts`, `lib/customer/profile.ts` (the contact panel's
intelligence card), `lib/dashboard/impact.ts` (the "N leads awaiting follow-up"
attention item, which survives — the work is real, only its destination moved to
/contacts), `lib/dashboard/overview.ts` (`leads_list` still feeds the hero's
"recovered" figure), `lib/dashboard/timeline.ts`, `lib/inbox/conversation-read.ts`,
`lib/learning/harvest.ts`, `lib/opportunity/context.ts`,
`lib/playbook/suggestions.ts`.

**So the honest position:** removing the screen was cheap; removing the concept
is not. `leads` is a data spine, not a page. A delete would have to answer what
happens to the drip cron, to Amy's snapshot, and to Business Brain first.

**Not in scope and not related:** `crm_leads` and `/api/partner/crm/leads` are
Partner OS — the partner's own prospect pipeline. Untouched.

## §27 — /v2/kit and /v2/render-probe soft-404 in production

Found verifying the 2026-08-24 deploy. Both return **HTTP 200 with the 404
page as the body**. `/render-probe/dashboard`, which is not under this route
group, correctly returns 404.

**Nothing is exposed.** `notFound()` is the first statement in both pages,
before any query runs, and the kit's `load()` — which uses an admin client and
picks the tenant with the most catalogue rows across the whole platform — never
executes. Zero `.v2k-block` elements render. This is a status-code defect, not
a data one.

**Why.** `app/(v2)/v2/layout.tsx` does async work (getUser, getActiveTenantId)
and then renders a shell. By the time the page below it throws `notFound()`,
the response has begun streaming and the 200 is already committed, so Next can
only render the not-found UI into it. The pages outside this route group have
no such layout and set the status correctly.

**Why it matters anyway:** a soft 404 is indexable and invisible to uptime
monitoring. The layout already sets `robots: { index: false }`, which limits
the first, so this is low priority — but the two locks these routes are
supposed to have (middleware `isDevProbe` + `notFound()`) only deliver one and
a half in production. Both were verified to actually block; only the status
line is wrong.

## §28 — Business Brain: the inventory, for a delete decision

The dashboard card is gone (8d1edb6). Nothing else has been deleted. This is
the full surface, so the decision can be made from a list rather than from a
guess.

**A correction to that commit message first.** It says the card "was the only
link into /ai-employees/[id]/brain from anywhere a person lands". That is
wrong. `app/ai-employees/[id]/page.tsx:44` still carries a full-width card —
Brain icon, heading "Business Brain", subtitle "What your AI understands about
your business — and what it recommends." The feature is still reachable, two
clicks in, from the AI employee's own page. Left deliberately: that is the
feature's natural home, and removing it is part of the full delete, not part of
clearing the dashboard.

### Is /ai-employees/[id]/brain part of it? Yes — it is the feature's only page

Its entire body is `<BusinessBrain agentId agentName />`. The page itself reads
only `ai_employees`, for the name and the ownership check; every figure on it is
fetched client-side from the three brain APIs, and the component imports twelve
symbols from `lib/brain/present`. It is not a separate feature that shares a
word.

### THE TRAP: `lib/brain/context/` is NOT Business Brain

Eleven files — `orchestrate.ts`, `registry.ts`, `types.ts`, `providers/*` — that
happen to live in the same directory. Its export `assembleBusinessContext` has
five live consumers: `lib/amy/answer.ts`, `lib/anthropic/pipeline.ts`,
`lib/email/reply.ts`, `app/api/webhooks/twilio/voice/route.ts`,
`app/api/ai/amy/snapshot/route.ts` — the voice agent, Amy, and email replies.
No file in `lib/brain/context/**` imports a sibling `lib/brain/*.ts`, and no
`lib/brain/*.ts` mentions context. **`rm -rf lib/brain` breaks the phone.** If
the rest of `lib/brain` goes, this should move to `lib/ai-context/` so the
directory stops implying ownership.

### Exclusively Business Brain — safe to delete together

Page: `app/ai-employees/[id]/brain/page.tsx`.
API: `app/api/brain/[agentId]` (GET, the read view), `app/api/brain/run/[agentId]`
(POST, runs the analysis), `app/api/brain/briefing/[agentId]` (POST, the COO
briefing text + Aura TTS), `app/api/brain/cron` (GET+POST, the nightly study).
Components: `components/ai-employees/business-brain.tsx`, and
`components/dashboard/business-brain-card.tsx`, which is now orphaned — zero
importers repo-wide.
Lib: the nine non-context files in `lib/brain/` — engine, types, patterns,
understanding, recommendations, confidence, view, present, updates (~944 lines).
Script: `scripts/brain-demo.ts` (referenced by no package.json script; its header
names a tsconfig that does not exist).

### It runs on a schedule

`vercel.json`: `/api/brain/cron` at `0 8 * * *`. Nightly it walks up to 300
tenants, picks each one's active AI employee, snapshots, runs the analysis and
writes the diff. `maxDuration = 300`. Deleting the feature means removing that
entry AND the path from the middleware bypass list (`lib/supabase/middleware.ts:78`).

### Six tables, owned outright

`business_patterns`, `business_understanding`, `business_recommendations`,
`business_dna` (all from `supabase/migrations/add_business_brain.sql`),
`brain_updates` (`add_brain_updates.sql`), `brain_briefings`
(`add_brain_briefings.sql`). A repo-wide grep for all six names returns nothing
outside `lib/brain/` and `app/api/brain/` — no other feature reads this data.

The engine only READS the shared tables: conversations, messages, leads,
appointments, payments, payment_requests, tenants, connected_calendars. It
writes nothing outside its own six.

### Edits required in shared files, if it goes

`app/ai-employees/[id]/page.tsx` — the link at :44 and the `Brain` import at :6.
`vercel.json` — the cron entry. `lib/supabase/middleware.ts:78` — the bypass.
`lib/ratelimit.ts:38-39` — the `brain_run` and `brain_read` buckets, used by
nothing else. `lib/modules.ts:20` — the `business_brain` module key, which is
declared, shown in the admin module UIs, and **never actually enforced**: no
brain route checks it.

### Must NOT be deleted

`lib/brain/context/**` (above). `lib/playbook/data.ts` (provides `authAgent` to
three brain routes but belongs to Playbook), `lib/deepgram/speak.ts` (shared
with phone calls), `lib/cron/auth.ts`, `lib/billing/gate.ts`.
`components/ai-employees/business-intelligence-progress.tsx` wears a Brain icon
and is the **Learning** feature, not this one.

### There are no tests

Not one. The engine, the confidence scoring, the patterns, the presenter — all
untested. `lib/brain/context/orchestrate.test.ts` tests the shared layer and
stays. This cuts both ways: a delete breaks no test, and nothing would have
caught a regression if it had stayed.

## §29 — what the kit still lacks, after /contacts

Three gaps the migration filled by extending an approved component, and one it
could not.

**Filled, and now in the tokens rather than in a page:** `.v2-chip-sq` had
geometry only inside a card or a notice, so its first use outside either
collapsed; `.v2-head` did not wrap, so a header with two actions overflowed at
390px; the scoped responsive utilities stopped at `lg`, and the table's last two
columns need `xl`.

**NOT FILLED — the kit has no modal.** /contacts opens two: New contact and the
three-step Import wizard. The kit has a bottom drawer (`.v2-drawer`), which is
the phone's answer, and a card. Both dialogs are currently the card's edge
language at dialog width on the same dimmed veil — one hairline, no shadow, the
form's rules inside — built inline in the two components rather than promoted.
That is a deliberate hold: a modal is a real component with focus trapping,
escape handling and a scroll lock, and inventing one unreviewed is how a second
language starts. **This is the next thing the kit should gain**, and these two
dialogs are the candidate to review it against.

**Also noted, not fixed:** a contact whose only identifier is a phone number
gets `+` as its initial, on both the list and the detail header. v1 did the same
(`title[0]`), so it is not a regression — but it means every phone-only contact
in the book wears the same meaningless chip. Stripping the leading `+` would
give a digit; that is a content change, not a reskin, so it waits.

## §30 — Business Brain is deleted; the six tables are not, yet

Done on 2026-08-24, from the §28 inventory. Gone: `app/ai-employees/[id]/brain`,
all four `app/api/brain/*` routes, `components/ai-employees/business-brain.tsx`,
`components/dashboard/business-brain-card.tsx`, the nine non-context files in
`lib/brain/`, `scripts/brain-demo.ts`, the `/api/brain/cron` entry in
vercel.json, its middleware bypass, the entry card on `/ai-employees/[id]`, and
the two orphaned `brain_run` / `brain_read` rate-limit buckets.

`lib/brain/context/**` is untouched and all five consumers verified intact —
Amy's answer path and snapshot route, the Anthropic pipeline, the email reply
path, the Twilio voice webhook.

**THE SIX TABLES ARE STILL THERE, ON PURPOSE.** `business_patterns`,
`business_understanding`, `business_recommendations`, `business_dna`,
`brain_updates`, `brain_briefings`. Verified after the delete: a grep for each
name across `app/`, `components/`, `lib/`, `scripts/` and `types/` returns
**zero**. Nothing reads them, nothing writes them, and the nightly job that
filled them no longer runs. Drop them in a week if nothing surfaces —
`add_business_brain.sql`, `add_brain_updates.sql`, `add_brain_briefings.sql` are
the migrations that created them.

**One thing to do WITH the drop, not before it.** `lib/modules.ts` still
declares the `business_brain` key. It is annotated in place and deliberately
retained: 27 of 33 tenant rows carry `'business_brain'` in their
`enabled_modules` JSON, and `ModuleKey` is derived from that tuple — removing
the line narrows the type and turns stored data into an unknown key. That is a
data migration (strip the value from every tenant, then drop the key), and it
belongs in the same change as the tables. It gated nothing while the feature
existed, so the cost of leaving it is one dead row in /admin/modules.

## §31 — the modal exists in the kit; §29's gap is proposed, not closed

Built 2026-08-24 as kit pair 10. `components/v2/modal.tsx` + `.v2-modal` in the
tokens. **Neither /contacts dialog is migrated** — both still carry their own
inline panel, so this is a proposal beside the thing it would replace.

The shape is the card's edge on the veil: one hairline, no shadow, 16px radius,
the same paper, over the same `.v2-veil` the drawer uses. Below 560px it becomes
the drawer's shape — full width, seated on the bottom edge — because a centred
box on a phone is a card with margins pretending to be a dialog.

What a screenshot cannot show, and what the promotion is actually for — all
verified with a real keyboard against the dev build:

  focus goes in       to the first focusable inside, never left on the button
                      behind the veil
  focus stays in      24 forward Tabs and 24 backward Tabs never leave; the
                      focusables are re-read on every keypress, because the
                      import wizard replaces its whole body between steps
  focus comes back    to whatever opened it, restored in a cleanup so it also
                      happens on unmount rather than only on a tidy close
  the page holds      body overflow hidden, released on close
  escape, veil click  both close; `dismissable={false}` disables both while a
                      request is in flight
  role                dialog, aria-modal, aria-labelledby the mono title

**One caveat on the scroll lock.** It replaces the scrollbar's width as body
padding so the layout does not shift sideways when the dialog opens. Verified as
"no shift" — but headless Chromium uses overlay scrollbars, so the measured gap
was 0 and the replacement branch never ran. It is correct by construction and
unexercised in this environment; the case that would prove it is a desktop
browser set to always-show scrollbars.

### And a defect the modal work uncovered: THE KIT DID NOT SCROLL

`.v2` is `height: 100dvh; overflow: hidden`, because /v2's screens own the
viewport. `app/(v2)/v2/layout.tsx` puts that class on the wrapper around every
page in the tree, including /v2/kit — which is a 5,082px document. Ten pairs,
one screen of them reachable.

It stayed invisible because an `overflow: hidden` box is still
*programmatically* scrollable: `element.screenshot()` scrolls it into view
happily, so every capture of the kit worked perfectly while a person with a
scroll wheel could not get past pair 1. Every review of this kit so far has been
of images I scrolled to with code.

Fixed with `.v2:has(> .v2-embedded) { height: auto; min-height: 100dvh; overflow:
visible }` — a `.v2` wrapper whose page has declared itself embedded is carrying
a document, not a screen. A child cannot unclip its ancestor, so the ancestor
asks. Inside the (v2) tree only the kit is `.v2-embedded`; the app's own embedded
pages are not inside a `.v2` parent, so nothing else is touched.

## §32 — item (b) is done: the phone navigates through /v2's sheet

Shipped 2026-08-24. v1's five-slot tab bar and its "More" drawer are gone —
`components/dashboard/mobile-sheet.tsx` + `.v2-navhost`, carrying the rail's
three sections.

**Why the bar had to go, beyond the design.** It held four routes and a More
button, and *which* four you got came from `visibleNav.slice(0, 4)` — the list
after module gating. So a business with Inventory on navigated differently from
one with it off, and neither could be taught where anything was. The sheet has no
split: same sections, same order, same rows as the rail beside it, built from the
same `visibleNav` and the same `SECTIONS` array. One list, so they cannot drift.

**The sheet is /v2's, not a copy of it.** `.v2-sheet` is `position: absolute`
because on /v2 it lives inside `.v2-root`. Rather than write a second sheet, the
host is `position: fixed; inset: 0` so the sheet's `absolute` resolves against it
and every rule it already has — 88dvh, the radius, the translateY(100%) at rest,
the 0.42s settle, `[data-open]` — applies unchanged. The drag hook is /v2's too,
including its rule that a downward drag scrolls rather than closing when the list
is scrolled down.

**Two things this uncovered, both fixed here:**

- **The host painted the app white.** `.v2` sets `background: var(--v2-paper)`,
  and on a fixed inset-0 element at z-index 55 that is a sheet of white over
  everything. The first render was a blank screen with a handle on it. The host
  now sets `background: transparent` explicitly, and the test says why.
- **Every avatar in the app had already broken, in the commit before this one.**
  `RobotAvatar` found the dome by reading `AssetSet.scan` — which is a *drawing*
  instruction, and removing Rudi's overlay removed it. The avatars silently fell
  back to a plain centre-cover crop of a 784×1660 plate, which is a circle of
  empty stage; that shipped. `scan` and the new `face` are now separate: one is
  what to draw, the other is where the subject is, and a persona that draws
  nothing still has a face. Measured off both new plates rather than carried over.

**The bottom of a phone, measured at 390×844:** handle `[0, 796, 390, 49]`, bell
`[334, 744, 44, 44]`, Talk `[108, 714, 175, 54]`. No two intersect, and each owns
the pixels at its own centre. Verified on the production build in a real touch
context with `force` banned: the sheet opens on a tap and navigates, the bell
opens, contact-info on /inbox/[id] opens, Talk takes its own tap.

**One thing that is not a regression and is worth naming.** The handle is a
full-width 49px strip, so a list row passes under it mid-scroll. v1's tab bar was
60px in the same place and did the same; `main`'s 72px bottom padding still
clears the end of a list. The check that guards this now distinguishes a row that
scrolls from a control the page pinned to the edge, and only fails on the second.

## §33 — after /appointments and /orders: what is done, and what is not

Both trees are migrated: zero v1 in page on all nine routes at 1440 and 390,
and in every state driven through the real UI.

### Three corrections to the brief, all measured

**The board has no drag.** Despite the name, its cards are plain `<Link>`
elements — no `draggable`, no dnd library, no drop targets. Stage moves happen
on the detail page through `StageControl`, and the approval stages reject a
manual move server-side. There was no drag state to drive.

**/appointments did not exist.** The schedule lived only at
`/dashboard?tab=appointments`, which is why the rail's row had been INERT since
the shell was reskinned. Deleting the tab strip without giving it a page would
have deleted the schedule. Same query, same rows; it gained a URL, a live rail
row and its own `scheduling` gate.

**Five components had no kit equivalent, not three.** The action bar, the
key-value list and the dropzone were named; the CHECKBOX ROW (hand-spelled in
four files) and the TYPEAHEAD POPOVER (two of them, both `shadow-lg`) turned up
during the work. All five are in the kit as pairs. The key-value list turned out
not to be new at all — `.v2-facts` already existed and /orders was building its
own.

### Known and deliberately not done

**~~`.v2-act`'s base ink is 2.94:1.~~ FIXED — approved 2026-08-24, see §34.**

**/appointments over-fetches.** It calls `getDashboardData`, which runs eight
queries — analytics events, conversations, leads, AI employees — and uses one of
them. Shared with the dashboard, which needs all eight, so splitting it is a
change to that hot path rather than to this one.

**The letterhead tree stays out of scope permanently** (§25). Excluded and
untouched: `document-body.tsx`, `components/documents/letterhead.tsx`,
`document-branding.tsx`, `send-document.tsx`, `letterhead-choice.tsx`,
`print-button.tsx`, `doc-settings-modal.tsx`, and the public `/e/[token]`
approval copy with `public-approval.tsx` and `factory-delivery.tsx`. Those last
two are customer-facing pages outside the app shell — a separate decision from
this migration.

**`/orders/[id]/document/[type]`'s own toolbar** uses the `neutral-` greyscale
and sits on the excluded page. It is app chrome on a document route; whether it
follows the app or the document is a decision, not an oversight.

## §34 — the chip ink, fixed

Approved from §33 and done. Both chips and the filled pill now clear 4.5:1, and
the fix is by LIGHTNESS: `oklch(from C L c h)` keeps chroma and hue exactly and
moves only lightness. `--v2-ink-l: 0.48` for a label on a tint, `--v2-solid-l:
0.52` for a filled ground under white — the shallowest depths that clear AA for
every hue the app passes in, which is the four tints, the red, the live green,
the mute and all thirteen order stages.

**Why not a mix toward black,** which is what the destructive variant did first:
one fixed ratio has to satisfy the darkest hue, and 50% is what cyan needs —
which takes `#ff2e93` to `#7f1749`. That is not a deeper pink, it is a maroon.
Per-hue ratios cannot be written in CSS; a per-hue lightness can. The
destructive variant now follows the same rule and its bespoke `--v2-red-ink`
token is only used for red text that is not a chip.

Written as `@supports (color: oklch(from red 0.5 c h))` rather than as two
`color:` lines in one rule. The two-line spelling is the usual
progressive-enhancement idiom and is also, exactly, a rule declaring the same
property twice — which `app/css-duplicates.test.ts` forbids, having been written
after a real duplicate shipped. An exception for "the intentional ones" would
make that guard a matter of opinion.

### Two things this turned up

**Every chip inside a list row had been rendering grey.** `.v2 .v2-row .v2-m
span` is (0,3,1) and reached the `.v2-stat` chips in a row's title line, which
are (0,1,0). The background was the right hue so it looked right; the label was
`--v2-ink-46` at 2.7:1. Shipping since the rows did. The rule now matches direct
children only, which is what the sub-line it exists for actually is.

**A translucent ink cannot be deepened.** `--v2-ink-45` was the hue for a chip
with no colour, at 2.74:1, and setting the lightness of a 45%-alpha colour still
leaves 45% alpha. Those chips take a new solid `--v2-mute: #63636b` (5.04:1).

### Verified

142 rendered chips across eleven routes, measured from computed styles with
colours resolved through a canvas — worst 5.34:1. The reporter is byte-identical
before and after on all nine migrated routes: only the colour moved.

The measurement itself needed fixing first: the first version regex-scraped
numbers out of the computed string, which turns `oklch(0.48 0.2478 358.06)` into
`rgb(0.48, 0.25, 358)` and reports a contrast for a colour nothing on the page
is. It said the fix had not worked when it had.

## §35 — the media and code block, and one bug it turned up

`/catalog/[id]` needed the last of the four components the detail pages surfaced
with no kit answer. Designed first as a kit pair, then used.

**The design.** A catalogue item has two portraits: the photograph a person
recognises across a showroom, and the code a phone reads at arm's length. v1 kept
them apart — the photo small in the summary card at the top, the QR in a white
box of its own three sections down under a 16px heading — so the one screen that
has both never showed them together, and the sentence explaining what the code is
for sat as grey body copy beside it.

`.v2-shots` / `.v2-shot` puts them on one baseline: same square, same radius, same
hairline, each named by the micro-label this language already uses for "what this
is", with the caption under the thing it describes and the action under the thing
it acts on. `--shot` sets the size, so a 112px detail block and a 56px row
thumbnail are one component. The action is `.v2-act`; nothing here is a new
control. The code frame gets 7px of white padding — a QR is edge-to-edge modules
and without a quiet zone inside the frame the hairline reads as part of the code.

### The bug: `--v2-ink-24` does not exist

It is referenced **23 times** in `v2-tokens.css` and defined nowhere. Every one of
those declarations is invalid, so each property falls back to its inherited or
initial value. For `color` that is inherited ink, which is why nothing ever looked
broken — those labels are simply darker than intended. For `stroke` the initial
value is `none`, which is how it surfaced: the fallback icon in the new frame was
drawn in no colour at all.

All 23 sites are on the `/v2` prototype routes (`.v2-conv`, `.v2-ag-*`,
`.v2-iv-*`, `.v2-igrid`), not on migrated app pages, and two tests pin the
declaration text. **Not fixed here on purpose:** defining the token would lighten
23 places at once, several of them mono micro-labels that would land near 2:1 —
the exact thing §34 just spent a pass removing. It needs a decision about what
each site should be, not a one-line define. The new rule uses `--v2-ink-45`, the
same stroke `.v2-drop`'s icon uses.

## §36 — /catalog and /ai-employees

Both pairs done: eighteen routes now report zero v1 classes in the page column at
1440 and 390×844, measured against the kit with real probe-tenant data.

### The one-face rule reaches the place the face is set

`EmployeeAvatar` rendered `voiceAvatar(voice)` — the stock headshot of whichever
TTS voice the tenant had picked. It is the single identity primitive, used by the
employee list, the editor, the weekly-win card and Ask Amy, so **a voice dropdown
was changing an employee's face in four places at once**, and the portrait sat
beside the robot that the dashboard hero and the inbox rows already show. It is
`RobotAvatar` now, with the presence dot unchanged. `lib/employee`'s
`voiceAvatar` and its five-entry map went with it, and the file's header — which
declared "the face of an AI employee is the headshot of the voice" as the single
source of truth — now says what is actually true.

The **voice picker keeps its five portraits** and that is deliberate: choosing
whose voice the employee speaks in is a different question from who the employee
is, and `lib/voices.voiceHeadshot` still owns it. `components/ai-employees/one-face.test.ts`
pins both halves.

### One field language, not two

`.v2-finput` — the /v2 agent prototype's field — was a bordered 12px box with a
4px violet focus ring, designed before the kit's form language existed. Every
migrated screen since uses `.v2-fld`'s rule, and the kit is explicit that "the
point is no box". Adopting the prototype's screen without this would have made
/ai-employees the one place in the product with boxed inputs. `.v2-finput` is now
the same rule, with the same focus behaviour; `.v2-field` keeps its padding, and
the divider it drew above a stacked field went, because the field's own rule was
already there and two hairlines eight pixels apart is what that produced.

### What the sweep caught

**`.v2-shot > span` (0,1,1) beat `.v2-act` (0,1,0)** and painted the Download
pill's label in caption grey at 2.64:1. It only showed on /v2/kit, because there
the control is a `<span>` and on the real pages it is a `<button>` — the live
contrast sweep found it, review would not have. Captions carry no class; every
control does, so the rule is `:not([class])` now. Same failure mode as
`.v2-row .v2-m span` reaching the chips in a row title (§34).

**`.bip-shimmer` was applied to the progress fill instead of an overlay child.**
It sets its own background and animates `translateX(-100% → 220%)`, so the
business-memory bar lost its gradient and slid 316px right of its track. Measured,
not eyeballed.

**Both sticky save bars were pinned at `bottom-[calc(4.5rem+safe)]`** — 4.5rem
being the height of the bottom tab bar that no longer exists. One bar now, offset
from `--v2-grab-h`, and moved clear of the notification bell, which is fixed in
the same corner: a Save that lands under the bell is a Save nobody can press.

### 206 chips across 18 pages, worst 4.92:1

### Two decisions worth naming

**In stock carries no colour.** v1 painted it green, so every ordinary row in a
catalogue of hundreds wore a coloured badge and nothing stood out. Green is
reserved for transient state and this palette avoids the traffic-light set; in
stock is the absence of a problem, so colour marks the exception — out of stock,
incoming, special order, needs pricing — and the ordinary shelf is mute.

**The catalogue's floating add button is gone.** It sat at `bottom-[86px]`, a
position chosen for the bottom tab bar. Four `.v2-act` pills wrap onto two lines
at 390px, which beats a fifth thing hovering over the swipe-up sheet.

### Widened scope, deliberately

`components/settings/availability-client.tsx` renders in two places — embedded in
the AI employee screen and as the standalone /settings Reviews page. Migrating
only the embedded branch would have left a v2 section inside v1 page chrome, so
both went. That route was not in this pass's scope; it is thirty lines.
