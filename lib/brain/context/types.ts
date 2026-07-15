import type { SupabaseClient } from '@supabase/supabase-js'

// ── Unified Business Context layer ──────────────────────────────────────────────
// Every business module registers itself as a ContextProvider. Before an AI response, the
// orchestrator detects which modules the user is asking about, fetches ONLY those (live, tenant-scoped),
// and injects a delimited block into the model prompt. Adding a module = adding one provider file.

export interface ContextRequest {
  tenantId: string
  agentId: string | null
  channel: string // 'sms' | 'voice' | 'email' | 'instagram' | 'facebook' | 'whatsapp' | 'chat'
  query: string // the customer's latest message — drives intent detection
  contactId?: string | null // the identified customer, if known (customer-scoped data must never leak across customers)
}

export interface ContextResult {
  available: boolean // false → the block states the data is unavailable (anti-hallucination)
  text: string
}

export interface ContextProvider {
  key: string // stable module identifier
  label: string // section heading in the injected block
  keywords: string[] // matched (substring, lowercased) against the query to decide relevance
  alwaysOn?: boolean // include even with no matching query (e.g. realtime voice has no transcript yet)
  fetch(req: ContextRequest, db: SupabaseClient): Promise<ContextResult>
}
