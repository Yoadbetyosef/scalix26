# Catalog ingestion + retrieval — what's outstanding

Written 6 Aug 2026, at the point the feature was parked. Everything below is known-incomplete or
known-unknown; the parts that work are in `README.md` (worker) and the code comments.

**State when parked.** Ingestion is live and verified end to end on three tiers (Shopify, WooCommerce,
JSON-LD) against real stores. Retrieval is live on both the text pipeline and the voice agent — a real
call to Smith HVAC confirmed Deepgram invoking the tool and speaking the grouped answer. One real
tenant (Smith HVAC / naturesparkle.com, 9,179 products); no customers depend on this yet.

---

## 0. PATTERN: a route voice-server calls, missing from the middleware allowlist

**Three occurrences. The third was found by the test written after the second, and it was already live
in production.**

| route | found | state |
|---|---|---|
| `/api/catalog/lookup` | during the retrieval build | fixed then |
| `/api/catalog/keyterms` | 7 Aug 2026, before first use | fixed same day |
| `/api/stripe/connect/payment-link` | 7 Aug 2026, **by the test** | **had never worked on a call** |

### Why it is invisible every time

```
middleware 307s to /auth/login  →  voice-server receives an HTML login page
→  JSON.parse throws            →  the catch swallows it
→  the agent behaves exactly as it did before the feature existed
```

Nothing errors. Nothing logs. There is no failed request to find, because the request succeeded — it
returned a login page. Every one of these handlers has a sensible fallback ("I can check with the team
and get back to you"), and that fallback is indistinguishable from the feature working and finding
nothing. The payment-link tool sat broken for however long the Payment Collection feature has shipped.

**This is the same class as the ladder floor**: the incident was recorded, the CLASS was not. Fixing
`/api/catalog/lookup` did not prevent `/api/catalog/keyterms`, because what got written down was "this
route needs to be public" rather than "routes voice-server calls need to be public, and the failure
looks like success."

### The structural answer, built

`lib/supabase/public-routes.test.ts` reads every `${appUrl}/…` path out of **voice-server's source**
and asserts each is covered by a `PUBLIC_ROUTES` prefix. `PUBLIC_ROUTES` is exported from
`lib/supabase/middleware.ts` for exactly this.

Reading the source rather than a maintained list is the point. A hand-kept "routes voice-server calls"
list would drift the same way the allowlist did — the failure mode IS forgetting, and a second thing to
remember does not fix forgetting. The test also asserts the regex still finds something, so a refactor
to a different URL-building style fails loudly instead of passing on an empty set.

**What it does not cover:** a URL built by concatenation or from a variable path. If voice-server ever
constructs one that way, the guard goes blind. The `expect(paths.length).toBeGreaterThanOrEqual(4)`
check is the tripwire for that, not a solution to it.

### The eventual shape: an `/api/voice/*` namespace

Every route voice-server calls under one prefix. One allowlist entry covers all of them, the
requirement becomes obvious from the path itself, and a new voice route is public by construction
rather than by remembering — which is the only version of this that needs no test at all.

Today that is nine routes across five unrelated prefixes: `/api/catalog/lookup`,
`/api/catalog/keyterms`, `/api/appointments/available`, `/api/appointments/book`,
`/api/stripe/connect/payment-link`, `/api/conversations/voice`, `/api/leads/inbound/`,
`/api/analytics/call`, `/api/webhooks/twilio/voice/handoff-fallback`.

**Why not now: the deploy window would produce this exact failure.** voice-server runs on Railway and
the app on Vercel; they deploy separately and never atomically. Moving a route means the app serves the
new path while voice-server still calls the old one, or the reverse — and the symptom of a voice-server
calling a path the app no longer serves is a 404 or a redirect, swallowed by the same catch, presenting
as the same silent nothing this section is about. The migration would reproduce the bug it fixes.

It is doable safely, just not cheaply: serve both paths for a release (rewrites from the old to the
new), deploy voice-server onto the new ones, confirm from the logs that nothing hits the old paths, then
remove them. Three coordinated deploys to remove a class of bug that a test now catches — worth doing
when something else already requires touching both sides, not on its own.

---

## 1. ~244ms of the retrieval path is outside the database

The measured position, on a clean table after `VACUUM ANALYZE`:

```
p50 188ms   p95 251ms   timeouts 4/20   resolved 14/20     (server-measured took_ms)
EXPLAIN on the same 4-token query:  execution 0.817ms, planning 19.2ms
```

So the database does ~1ms of work and the path reports ~245ms. **Where the rest goes is not known.**

The four timeouts are all 3–4 token phrases sitting on the 250ms budget line, and they are borderline
rather than slow: `"how much is the emerald cut halo ring"` resolved at 245ms while
`"emerald cut halo ring"` timed out at 251ms — identical tokens, 6ms apart.

**Next step is measurement, not tuning.** Add per-stage timings to `/api/catalog/lookup`:

- tenant lookup (the route's own read, currently outside `took_ms`)
- the website query and the inventory query separately
- how many ladder rungs ran (`lib/catalog/retrieval.ts`, `ladder()`)
- grouping time

~10 lines, no behaviour change. Until that exists, anything else is guessing — two commits during this
build were guesses against bad measurements and one of them made latency worse.

**One unverified hypothesis, recorded so it isn't re-derived:** every 2-token phrase landed at
96–129ms and every multi-token phrase at 188–251ms. Two-token phrases ran exactly one query (the
ladder floor prevented a second rung); longer ones can run two. That is *consistent with* a PostgREST
round trip from Vercel costing ~100ms. It is correlation only — do not act on it without the
per-stage numbers.

> **UPDATE, 7 Aug 2026 — that ladder-floor observation was a RECALL BUG, not a latency note.**
> A caller asked for a "RAJA sofa"; the tenant holds eight RAJA products including the 2.5-seater they
> wanted, and the agent said "I'm not seeing it in the system". Tokens are ANDed, so the query needed
> one product matching both words, and the floor stopped it retrying on "raja" alone. Fixed to
> `Math.max(1, n - 1)` — the stated intent — which changes n = 2 only.
>
> The latency figures above are now stale for two-token phrases: a two-token MISS costs a second round
> trip and lands in the multi-token band. Re-measure before drawing anything from those numbers.

**Also unexplained:** 19ms planning for a 0.8ms execution on a clean 9,179-row table. If PostgREST
re-plans per request that is ~38ms of the budget across two queries. Might be an SQL-editor artifact.

The budget itself is tunable without a deploy: `CATALOG_RETRIEVAL_TIMEOUT_MS` (default 250).

---

## 1a. SPEECH-TO-TEXT IS THE BINDING CONSTRAINT ON PHONE CATALOG ANSWERS

Bigger than latency. Bigger than the ladder. Established 7 Aug 2026 by a call that resolved it:

> The caller asked for a "RAJA sofa" and the agent could not find it. The caller then **spelled it
> out — R-A-J-A** — and the agent found it instantly, named the RAJA 2,5, correctly refused to quote a
> price, and offered a callback. Exactly the designed answer.

Everything downstream works. What never happened was "RAJA" reaching us as `raja`. Across two calls the
tool received `Vaja soda`, `Raja soda`, `Roger Solphine`, `Rosa raja`, `Raja sofa`.

**Do not credit the ladder floor or partial matching with solving this.** Both were real bugs and both
are correctly fixed, but neither was the binding constraint — a two-token query that never contains the
right token cannot be rescued by dropping a token.

**Every product name that is not an English word has this problem, which for an importer is most of
them.** RAJA, PARKAWAY, CAVALLO, NOMARO, JASIEK are Polish furniture names; a general English model has
no reason to produce any of them. This is the normal condition for this tenant, not an edge case.

### Measured: which repair actually works

Real observed damage against the intended word (7 Aug 2026):

| heard | target | soundex | levenshtein | trigram |
|---|---|---|---|---|
| `vaja` | raja | V200 vs R200 — **no match** | **1** | 0.25 |
| `rosa` | raja | R200 == R200 match | 2 | 0.11 |
| `yashek` | jasiek | Y220 vs J220 — **no match** | **2** | 0.08 |
| `parka way` | parkaway | match | 1 | 0.58 |
| `cavalo` | cavallo | match | 1 | 0.67 |
| `no maro` | nomaro | match | 1 | 0.50 |

**Soundex fails on the two cases that matter most**, and for a structural reason: it anchors on the
first letter, and substituting the initial consonant is exactly what the phone line does — `r`→`v`,
`j`→`y`. The J/Y confusion is what an English model does to a Polish name every time.

**Trigram similarity fails on all the hard ones** (0.25, 0.11, 0.08 — far under the 0.45 threshold),
because it compares SPELLING and the damage is PHONETIC.

**Edit distance catches every observed case at ≤2**, including both that soundex misses. If a repair is
built on our side, it should be Levenshtein against a distinctive-token list — not Soundex, and not a
lower trigram threshold. Note `sofa`/`soda` is also distance 1, which is the other half of the same
call.

### The two layers, and why the order is not arbitrary

**Deepgram `keyterms` fixes it at the source.** `agent.listen.provider.keyterms` is an array of plain
strings, supported on Flux v2 — which is what voice-server already runs — capped at 500 tokens, and
updatable mid-stream on Flux via the Configure control message. No separate charge is documented.

**Fuzzy matching fixes it after the damage,** and only for retrieval. The transcript stored in
`conversations`, the lead capture, and the model's own reading of what the caller said all keep the
wrong word. Keyterms improves every one of those; a fuzzy fallback improves exactly one.

That asymmetry is why keyterms goes first even though both are wanted. What a fallback buys that
keyterms cannot is coverage of words nobody anticipated — a product added after the call started, a
supplier name, a caller's own approximation.

### Do not send the whole catalogue as keyterms

500 tokens is the cap, and 131 product names would both exceed it and dilute the boost. Send the
DISTINCTIVE tokens only — RAJA, CAVALLO, NOMARO, JASIEK, PARKAWAY — not "stool", "sofa" or "table",
which a general model already produces correctly. That is roughly 20–40 tokens for this tenant.

Selecting them is the same corpus-frequency computation §1b needs for rung ordering: which tokens are
catalogue-distinctive rather than common English. One mechanism, two consumers — worth building once.

### Built: keyterms, with the cap as the design and not a footnote

`lib/catalog/terms.ts` computes the catalogue's own vocabulary — one function, two consumers, because
it is one question: is this word the catalogue's or the language's. `/api/catalog/keyterms` serves it;
voice-server fetches once at call setup and passes `agent.listen.provider.keyterms`.

Three states, all reported, none silent:

| state | when | what is sent |
|---|---|---|
| `ok` | every distinctive term fits | all of them |
| `truncated` | more terms than budget | the most-used, with `dropped` counted |
| `disabled` | selected terms would cover < 50% of products | **nothing**, with the numbers to explain why |

`disabled` is the one that matters. Smith HVAC has 9,179 products; 350 slots would boost a sliver while
every other product stayed exactly as broken, and the feature would read as configured and working. A
partial fix that looks total is worse than an absent one that says so — the owner stops looking for the
real problem. Size alone is not the disqualifier: 5,000 products under 40 brand names covers fine.

Both numbers are judgements, exposed on the endpoint so they can move with data. The word budget (350)
stands in for Deepgram's 500-TOKEN cap because subword tokens are not countable from here; being wrong
low costs a few unboosted terms, being wrong high returns an error and the call gets NO keyterms, so
the asymmetry picks the number.

### Still to measure: does damage survive boosting?

The evidence for whether the edit-distance net is needed at all, and it should be read the same way as
the embeddings decision — from data, not instinct. After keyterms have been live for a while:

```sql
-- Miss queries that look like a mangled catalogue term rather than a product we don't sell.
-- Needs: CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
SELECT l.query, count(*) AS times
FROM catalog_retrieval_log l
WHERE NOT l.resolved AND NOT l.timed_out AND NOT l.errored AND l.surface = 'voice'
  AND l.created_at > now() - interval '14 days'
  AND EXISTS (
    SELECT 1 FROM catalog_products p, unnest(string_to_array(lower(p.name), ' ')) term
    WHERE p.tenant_id = l.tenant_id AND length(term) > 3
      AND levenshtein(lower(split_part(l.query, ' ', 1)), term) BETWEEN 1 AND 2
  )
GROUP BY l.query ORDER BY times DESC;
```

A non-empty result after boosting means keyterms were not enough and the second net is earned. An
empty one means every failure we saw was boostable, and Levenshtein would be machinery for a problem
that no longer exists.

### Flux can narrow keyterms mid-call — the answer for large catalogues, later

Flux accepts a `Configure` control message that replaces the keyterm list mid-stream, without
reconnecting. So a `disabled` tenant could in principle start with no boosting, and after the caller's
first turn swap in terms drawn from what they actually said — 9,179 products cannot be boosted at once,
but the forty relevant to "I'm looking for a deadbolt" can.

Not built, and not worth building now: it needs a term index keyed by what a caller might say, which is
most of a retrieval system, to serve tenants who do not have this problem yet. Recorded because it is
the shape of the eventual answer and it should not be re-derived.

## 1b. Token distinctiveness is measured by string length, and that is not a proxy for anything

**RECALL, not performance** — filed deliberately, because the ladder-floor entry above sat under a
latency heading for weeks and a real caller hit it.

`lib/catalog/retrieval.ts`:

```js
const byDistinctiveness = (tokens) => [...tokens].sort((a, b) => b.length - a.length)
```

The ladder drops the *least* distinctive token first, so this decides which word survives when the full
phrase matches nothing. Measured 7 Aug 2026: `rosa raja` missed 3/3 against a tenant holding eight RAJA
products. `rosa` and `raja` are both four characters, so the sort is a coin toss, and it kept the word
that matches nothing while discarding the one that matches eight.

**Length was never a proxy for distinctiveness.** It correlated by accident on the phrases that were
tested — in jewellery, "platinum" happens to be longer and rarer than "ring" — and the correlation
breaks the moment two tokens are the same length, or a short word is the rare one.

The signal that is actually available is **how many products a token matches**. `raja` matches eight,
`rosa` matches zero. A token matching nothing is the one to drop, and that is knowable from the data
rather than guessed from the spelling.

**This matters most against transcription damage, which is the normal condition rather than an edge
case.** STT garbage is *by definition* a word that matches nothing in the catalogue — `Vaja`, `Rosa`,
`Solphine` were all produced by the phone line in a single call. Corpus frequency identifies that
class automatically; string length is a coin toss on exactly the input it most needs to get right.
Every phone call carries some damage, so a rescue rung that keeps the garbage word and drops the real
one fails routinely and silently.

Not built. It needs a cheap frequency signal — a per-token count query, or a cached term list refreshed
on sync — and adding a round trip to decide the rung order is the wrong trade on a path already
fighting its budget. Decide it alongside the per-stage numbers from `add_catalog_retrieval_3.sql`.

## 2. Embeddings — deferred, with the condition to revisit

No vector search, no pgvector, no embedding vendor. The reasoning: on catalogues whose titles spell
out every attribute ("Emerald Cut Diamond Hidden Halo Engagement Ring in Platinum"), tokenised
lexical matching already finds the row. Cost was never the argument — Voyage `voyage-3-lite` or
OpenAI `text-embedding-3-small` are both ~$0.004 per 10K products. The argument is machinery: a vendor
key on Railway, a pgvector migration, an HNSW index, an embedding lifecycle tied to `content_hash`,
a backfill, and a second failure mode on the call path.

**That is only honest while the miss rate is being watched.** It is, in `catalog_retrieval_log`.

```sql
-- miss rate by surface, last 7 days. 'test' is the /catalog box; exclude it for real numbers.
SELECT surface, count(*) AS queries,
       count(*) FILTER (WHERE resolved) AS resolved,
       count(*) FILTER (WHERE errored)  AS errored,
       round(100.0 * count(*) FILTER (WHERE NOT resolved) / count(*), 1) AS miss_pct,
       round(avg(latency_ms)) AS avg_ms, max(latency_ms) AS max_ms
FROM catalog_retrieval_log
WHERE created_at > now() - interval '7 days'
GROUP BY surface;

-- the phrases that missed. THIS is the list that decides whether embeddings are worth adding.
SELECT query, count(*) AS times, max(created_at) AS last_seen
FROM catalog_retrieval_log
WHERE NOT resolved AND NOT errored AND surface <> 'test'
  AND created_at > now() - interval '30 days'
GROUP BY query ORDER BY times DESC LIMIT 50;
```

`errored` is deliberately separate from `resolved`: an outage must never be read later as evidence
that the catalogue lacked a product. `timed_out` is separate too — a timeout is a miss the tenant
sees, but it is a latency problem, not a recall problem, and it must not be counted as one when
deciding on embeddings.

**What would change the decision:** a sustained real-call miss rate above ~15% where the missed
phrases are *semantic* rather than *lexical* — someone asking for "the green stone ring" when the
catalogue says "emerald". If the misses are typos, plurals, or words absent from titles, fix those in
`tokenize()` / `variants()` instead; they're cheaper and deterministic.

---

## 3. Dead-channel reconciliation — not built

**5 of 19 voice channels marked `connected` point at numbers this Twilio account does not own:**

```
+13187480408  Eran gaz          +19016602858  Yoads Butt Plugs
+13633002848  Smith Hvac        +19783213218  Asaplocksmith
+17276265301  Ella locksmith
```

Four are real customers. The app says their AI is live; the phone network has nothing to route.
Nobody finds out until someone dials — which is how this was discovered. Releasing a number in the
Twilio console doesn't tell the app.

`+13633002848` had a second fault worth noting: `ai_employee_id` was null, so even a restored number
would have had no agent config to build a prompt from. Smith HVAC has two voice channels and only
`+19179796516` is bound to an agent.

A job would walk `channels` against `IncomingPhoneNumbers` and reconcile. Left unbuilt deliberately —
whether a mismatch should silently flip to `disconnected` or page someone is a product decision, and
silently flipping it would hide the same problem in a different place.

---

## 4. Other things worth knowing

**The small-catalogue path has never run against real data.** `lib/catalog/snapshot.ts` injects the
whole product list into the prompt under `SNAPSHOT_MAX_PRODUCTS` (80) instead of calling the tool.
Every tenant with a catalogue today has 9,179 products, so this branch has only ever returned null in
production. It is the path most locksmith and HVAC tenants will actually take. Test it before
onboarding one.

**`lib/catalog/retrieval.ts` has no unit tests.** `grouping.ts` and `detector.ts` do (16 and 3). The
retrieval module is the one that talks to two tables and merges them, and it is covered only by the
live measurements in this document.

**Cluster labels degrade on less-templated catalogues.** The label is the common title stem, so
"Emerald Cut Diamond Hidden Halo" comes out clean on generated titles and will come out rough where
naming is inconsistent. Watch it in the log before assuming it generalises.

**The trade vocabulary in `grouping.ts` will keep missing attributes** (it knows metal, size, finish,
colour, carat). That is expected — the fallback, "there are a few versions, from $439 to $1,769", is a
good answer and is what the tests pin. Add to the vocabulary only when a real trade needs it.

**Tier 5's field-map persistence only survives when the values live in meta tags or class-bearing
elements.** Where it can't derive a map, Haiku re-runs on the next sync, still capped at 100 pages.
`catalog_sync_jobs.stats.llmCalls` shows whether that's happening.

**The 2,000-URL crawl cap is silent.** `MAX_CRAWL_URLS` truncates a large site and the tenant is not
told their catalogue was cut short. `CATALOG_MAX_CRAWL_URLS` overrides it per deployment.

**`uaFallbacks` in `catalog_sync_jobs.stats`** counts how often the honest `ScalixBot/1.0` UA was
refused and the browser headers were needed. If that climbs, the honest-UA policy is costing coverage
and is worth revisiting with numbers.

**Two pre-existing lint errors in `app/catalog/`, deliberately not fixed.** Both are
`react-hooks/set-state-in-effect`: `app/catalog/[id]/page.tsx` (`useEffect(() => { load() }, [load])`)
and `app/catalog/page.tsx`. They predate the catalog ingestion and retrieval work — confirmed by
stashing those changes and re-running eslint, which reports the same two. Left alone because fixing
them means reworking how both pages load, and doing that midway through unrelated work is how an
unrelated regression gets attributed to the wrong change. They want a deliberate pass of their own.

**voice-server deploys separately from Vercel.** The catalog tool lives in `voice-server/server.js`
(function definition + handler branch); a Vercel deploy alone does not ship changes to it.
