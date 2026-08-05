# Catalog ingestion worker

Reads a tenant's product catalogue from their own website and keeps a copy in step with it.

This is a **separate Railway service**. It shares no process, no runtime and no request path with
`voice-server` — a crawl that stalls on someone's slow hosting must never turn into latency on a
phone call. The two services have nothing in common but the database they both reach over HTTPS.

## What it does

```
poll  → claim_catalog_sync_jobs (FOR UPDATE SKIP LOCKED)
      → detect the platform, if the source arrived undetected
      → stream products through the adapter for its tier
      → normalize → hash → diff → upsert in batches of 100
      → deactivate what the site no longer lists (ONLY after a clean run)
      → source: status = active, last_synced_at = now
```

Up to **10 sources at a time** per instance (`CATALOG_WORKER_CONCURRENCY`). Start more instances to
go faster: job claiming is atomic in Postgres, so two containers never take the same job.

## Deploying to Railway

1. **New Service → GitHub Repo →** this repository.
2. **Settings → Build:**
   - Root Directory: `/` (the repository root — *not* `catalog-worker/`)
   - Dockerfile Path: `catalog-worker/Dockerfile`

   The root context is required: the worker imports `lib/ingestion`, `lib/cost/rates` and
   `lib/billing/pricing` from the app so that extraction rules and pricing maths have exactly one
   definition in the codebase.
3. **Settings → Networking:** no public domain. This service takes no HTTP traffic.
4. **Variables:**

   | Variable | Required | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | yes | same project as the app (`bphpnlgjlklgwhewsnrm`) |
   | `SUPABASE_SERVICE_ROLE_KEY` | yes | service role — the worker bypasses RLS by design |
   | `ANTHROPIC_API_KEY` | yes | tier-5 extraction only; without it those sources fail cleanly |
   | `CATALOG_WORKER_CONCURRENCY` | no | default `10` |
   | `CATALOG_WORKER_POLL_MS` | no | default `10000` — idle poll interval |
   | `INGESTION_DEBUG` | no | set to anything to log transport failures per URL |

5. **Deploy.** Healthy output looks like:

   ```
   [catalog-worker] railway-abc123:1 up — concurrency 10
   [catalog-worker] https://someshop.com ok — +214 ~3 =1841 🔒2 ✗7
   ```

   Reading that line: 214 new products, 3 changed, 1,841 unchanged, 2 left alone because the tenant
   had edited them, 7 no longer on the site and now inactive.

## Scaling and restarts

- **More throughput:** raise the replica count. No coordination is needed.
- **A container that dies mid-job** leaves the job `running`. The next instance to boot re-queues
  anything stuck for over an hour, bounded by `max_attempts`.
- **SIGTERM** stops claiming immediately and gives in-flight jobs 20 seconds to land their last
  batch before aborting.

## Failure behaviour

Per-source failures are isolated — one broken site never fails the batch. Transport failures retry
three times with a widening, jittered gap. Two reasons never retry, because the answer will not
change on the third ask:

- `robots_blocked` — their robots.txt disallows the product paths. We stop and the app shows the
  tenant the line to add, or offers CSV. We do not route around it.
- `spa_unsupported` — the page is an empty mount point; there is nothing on the server to read.

**A failed or partial run never deactivates anything.** Marking absent products inactive happens only
after a run completes cleanly — otherwise one bad afternoon on someone's hosting silently empties
their catalogue.

## Cost

Tier 5 (`html_ai`) is the only tier that spends money: Claude Haiku, capped at 100 pages per source,
and only until it can work out where that site keeps its fields — after which the map is saved to
`extraction_pattern` and replayed for free. Every call is written to `usage_events` as it happens,
with the real provider cost and, for White Label clients, the snapshotted markup. Per-run totals are
in `catalog_sync_jobs.stats` (`llmCalls`, `llmCostUsd`).

`stats` also carries `uaFallbacks`: how often the honest `ScalixBot/1.0` User-Agent was refused and
the request had to be retried with browser headers. Worth watching — if it is high, the honest-UA
policy is costing coverage.

## Local run

```bash
cd catalog-worker
npm install
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… ANTHROPIC_API_KEY=… npm start
```

To try detection against a real site without touching the database:

```bash
# from the repository root
node_modules/.bin/tsx scripts/test-detection.ts https://some-shop.com
```
