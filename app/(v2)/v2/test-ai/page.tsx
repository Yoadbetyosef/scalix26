import { listPageContext } from '../list-page'
import { primaryAgent } from '@/lib/agents/primary'
import { createAdminClient } from '@/lib/supabase/server'
import { nameOf } from '@/lib/persona'
import { TestAiClient } from './client'

// Gated on `ai_voice`, exactly as app/test-ai/layout.tsx gates it.
export const dynamic = 'force-dynamic'

export default async function V2TestAi() {
  const { tenantId } = await listPageContext('ai_voice')
  // The sandbox spoke as "Rudi" in two hardcoded strings. It talks to whichever agent /api/ai/test
  // resolves — the tenant's default one — so it can say that agent's actual name instead.
  const agent = await primaryAgent<{ name: string | null; persona: string | null }>(
    createAdminClient(), tenantId, 'name, persona',
  )
  return <TestAiClient agentName={nameOf(agent)} />
}
