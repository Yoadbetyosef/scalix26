// The catalog ingestion worker.
//
// A separate Railway service on purpose. It shares no process, no runtime and no request path with
// voice-server: a crawl that stalls on someone's slow hosting must never show up as latency on a
// phone call. The only thing the two have in common is the database they both talk to over HTTPS.
//
// Start it as many times as you like. Jobs are claimed through a Postgres function using
// FOR UPDATE SKIP LOCKED, so instances never collide, and scaling out is a matter of raising the
// replica count.
import { hostname } from 'node:os'
import { claimJobs } from './db'
import { runJob } from './runner'

const MAX_CONCURRENT = Number(process.env.CATALOG_WORKER_CONCURRENCY ?? 10)
const IDLE_POLL_MS = Number(process.env.CATALOG_WORKER_POLL_MS ?? 10_000)
const BUSY_POLL_MS = 1_000

const WORKER_ID = `${hostname()}:${process.pid}`
const controller = new AbortController()
const inFlight = new Set<Promise<void>>()

let stopping = false

function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`[catalog-worker] ${signal} — no new jobs; finishing ${inFlight.size} in flight`)
  // Give running jobs a chance to land their last batch. Railway's grace period is the real ceiling;
  // past it the jobs stay 'running' and the sweeper below re-queues them on the next boot.
  setTimeout(() => controller.abort(), 20_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// A job left 'running' by a container that died has nobody to finish it. On boot, hand anything
// stale back to the queue — bounded by max_attempts, so a job that genuinely kills workers stops
// rather than cycling forever.
async function requeueAbandoned(): Promise<void> {
  const { db } = await import('./db')
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString()
  const { data } = await db.from('catalog_sync_jobs')
    .update({ status: 'queued', claimed_by: null, claimed_at: null })
    .eq('status', 'running').lt('claimed_at', cutoff)
    .select('id')
  if (data?.length) console.log(`[catalog-worker] re-queued ${data.length} abandoned job(s)`)
}

async function loop(): Promise<void> {
  console.log(`[catalog-worker] ${WORKER_ID} up — concurrency ${MAX_CONCURRENT}`)
  await requeueAbandoned().catch((e) => console.error('[catalog-worker] requeue failed:', (e as Error).message))

  while (!stopping) {
    const capacity = MAX_CONCURRENT - inFlight.size
    const jobs = capacity > 0 ? await claimJobs(WORKER_ID, capacity) : []

    for (const job of jobs) {
      // One source failing is one source failing. It never takes the batch, the instance, or another
      // tenant's sync down with it.
      const task = runJob(job, controller.signal)
        .catch((e) => console.error(`[catalog-worker] job ${job.id} crashed:`, (e as Error).message))
        .finally(() => { inFlight.delete(task) })
      inFlight.add(task)
    }

    await sleep(jobs.length > 0 || inFlight.size > 0 ? BUSY_POLL_MS : IDLE_POLL_MS)
  }

  await Promise.allSettled([...inFlight])
  console.log('[catalog-worker] stopped')
  process.exit(0)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

loop().catch((e) => {
  console.error('[catalog-worker] fatal:', e)
  process.exit(1)
})
