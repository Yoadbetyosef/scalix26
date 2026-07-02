import type { SupabaseClient } from '@supabase/supabase-js'

// ── Brain Updates (What changed today) ───────────────────────────────────────────
// A before/after diff around a Brain study — NOTHING here touches the deterministic
// engine or Business Confidence. It only records what changed, in the COO's voice.

const DNA_LABEL: Record<string, string> = { sales: 'Sales', pricing: 'Pricing', communication: 'Communication', customer: 'Customer', operations: 'Operations' }

export interface BrainSnapshot {
  dna: Map<string, number>                                   // strand -> strength
  understanding: Map<string, { confidence: number; title: string; statement: string }>
}

export async function snapshotBrain(admin: SupabaseClient, tenantId: string, agentId: string): Promise<BrainSnapshot> {
  const dna = new Map<string, number>()
  const understanding = new Map<string, { confidence: number; title: string; statement: string }>()
  try {
    const [{ data: d }, { data: u }] = await Promise.all([
      admin.from('business_dna').select('dna_strand, strength').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
      admin.from('business_understanding').select('understanding_key, business_confidence, title, statement').eq('tenant_id', tenantId).eq('ai_employee_id', agentId),
    ])
    for (const r of d || []) dna.set(r.dna_strand as string, Number(r.strength) || 0)
    for (const r of u || []) understanding.set(r.understanding_key as string, { confidence: Number(r.business_confidence) || 0, title: r.title as string, statement: r.statement as string })
  } catch { /* table not migrated -> empty snapshot */ }
  return { dna, understanding }
}

// Diff two snapshots into COO-voiced update rows and persist them. Returns how many.
export async function recordBrainUpdates(admin: SupabaseClient, tenantId: string, agentId: string, before: BrainSnapshot, after: BrainSnapshot): Promise<number> {
  const rows: Record<string, unknown>[] = []
  const base = { tenant_id: tenantId, ai_employee_id: agentId }

  // New understandings discovered.
  for (const [key, u] of after.understanding) {
    if (!before.understanding.has(key)) {
      rows.push({ ...base, kind: 'new_understanding', title: 'I discovered something new about your business', detail: u.statement })
    } else {
      const prev = before.understanding.get(key)!
      if (u.confidence - prev.confidence >= 5) {
        rows.push({ ...base, kind: 'confidence_up', title: "I'm growing more confident about something", detail: u.statement, delta: u.confidence - prev.confidence })
      }
    }
  }

  // DNA strands that got stronger.
  for (const [strand, strength] of after.dna) {
    const prev = before.dna.get(strand) ?? 0
    if (strength - prev >= 3) {
      rows.push({ ...base, kind: 'dna_up', dna_strand: strand, title: `Your ${DNA_LABEL[strand] || strand} DNA got stronger`, detail: `+${strength - prev}% today`, delta: strength - prev })
    }
  }

  if (!rows.length) return 0
  try { await admin.from('brain_updates').insert(rows) } catch { /* best-effort */ }
  return rows.length
}
