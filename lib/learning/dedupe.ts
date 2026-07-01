import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Content caching / dedupe (point 9): never send the same message/thread/transcript to the
// LLM twice. We hash the content and keep a per-tenant ledger (learning_seen). Everything
// here is best-effort: if the table isn't migrated, we degrade to "process everything once"
// rather than crash — the per-run budget still bounds the cost.

export function contentHash(s: string): string {
  return createHash('sha256').update(s || '').digest('hex')
}

/** Given candidate hashes, return the subset that has NOT been processed before. */
export async function unseenHashes(
  admin: SupabaseClient,
  tenantId: string,
  source: string,
  hashes: string[],
): Promise<Set<string>> {
  const all = new Set(hashes)
  if (!hashes.length) return all
  try {
    const { data } = await admin
      .from('learning_seen')
      .select('content_hash')
      .eq('tenant_id', tenantId)
      .eq('source', source)
      .in('content_hash', hashes)
    for (const r of data || []) all.delete(r.content_hash as string)
  } catch {
    // table absent → treat all as unseen (budget still caps spend)
  }
  return all
}

/** Record that these hashes have now been processed (so they're skipped next run). */
export async function markSeen(
  admin: SupabaseClient,
  tenantId: string,
  source: string,
  hashes: string[],
): Promise<void> {
  if (!hashes.length) return
  try {
    const now = new Date().toISOString()
    await admin.from('learning_seen').upsert(
      hashes.map((h) => ({ tenant_id: tenantId, source, content_hash: h, seen_at: now })),
      { onConflict: 'tenant_id,content_hash' },
    )
  } catch {
    // best-effort
  }
}
