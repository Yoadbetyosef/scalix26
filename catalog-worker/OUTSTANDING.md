# Catalog ingestion + retrieval — what's outstanding

Written 6 Aug 2026, at the point the feature was parked. Everything below is known-incomplete or
known-unknown; the parts that work are in `README.md` (worker) and the code comments.

**State when parked.** Ingestion is live and verified end to end on three tiers (Shopify, WooCommerce,
JSON-LD) against real stores. Retrieval is live on both the text pipeline and the voice agent — a real
call to Smith HVAC confirmed Deepgram invoking the tool and speaking the grouped answer. One real
tenant (Smith HVAC / naturesparkle.com, 9,179 products); no customers depend on this yet.

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
96–129ms and every multi-token phrase at 188–251ms. Two-token phrases run exactly one query (the
ladder floor prevents a second rung); longer ones can run two. That is *consistent with* a PostgREST
round trip from Vercel costing ~100ms. It is correlation only — do not act on it without the
per-stage numbers.

**Also unexplained:** 19ms planning for a 0.8ms execution on a clean 9,179-row table. If PostgREST
re-plans per request that is ~38ms of the budget across two queries. Might be an SQL-editor artifact.

The budget itself is tunable without a deploy: `CATALOG_RETRIEVAL_TIMEOUT_MS` (default 250).

---

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
