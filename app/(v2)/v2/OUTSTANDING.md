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
