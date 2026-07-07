// Real Anthropic spend from the org Cost Report (Admin API). Requires an ADMIN key
// (sk-ant-admin…) in ANTHROPIC_ADMIN_KEY — the standard API key cannot access it. Returns the
// actual USD cost from Anthropic (ground truth) or null if unavailable.
//
// The `amount` field is in the currency's lowest units (cents), so we divide by 100.
export async function getAnthropicSpend(startISO: string): Promise<{ total: number; byModel: Record<string, number> } | null> {
  const key = process.env.ANTHROPIC_ADMIN_KEY
  if (!key) return null

  const byModel: Record<string, number> = {}
  let total = 0
  let page: string | undefined

  try {
    for (let i = 0; i < 40; i++) {
      const params = new URLSearchParams({ starting_at: startISO, bucket_width: '1d' })
      params.append('group_by[]', 'description')
      if (page) params.set('page', page)

      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 8000)
      let j: { data?: { results?: { amount?: string; model?: string; description?: string }[] }[]; has_more?: boolean; next_page?: string }
      try {
        const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
          signal: ctrl.signal,
        })
        if (!res.ok) return total > 0 ? { total: Math.round(total * 100) / 100, byModel } : null
        j = await res.json()
      } finally {
        clearTimeout(to)
      }

      for (const bucket of j.data || []) {
        for (const r of bucket.results || []) {
          const amt = parseFloat(r.amount || '0') / 100 // cents → USD
          if (!isFinite(amt)) continue
          total += amt
          const label = r.model || r.description || 'other'
          byModel[label] = (byModel[label] || 0) + amt
        }
      }
      if (!j.has_more || !j.next_page) break
      page = j.next_page
    }
    // round the by-model map too
    for (const k of Object.keys(byModel)) byModel[k] = Math.round(byModel[k] * 100) / 100
    return { total: Math.round(total * 100) / 100, byModel }
  } catch {
    return null
  }
}
