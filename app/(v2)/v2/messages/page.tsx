import { createAdminClient } from '@/lib/supabase/server'
import { agentByPersona, primaryAgent } from '@/lib/agents/primary'
import { nameOf, PERSONAS } from '@/lib/persona'
import { readMilesInbox } from '@/lib/miles/inbox-read'
import { listPageContext } from '../list-page'
import { MessagesClient } from './client'

// MILES'S INBOX. Gated on `inbox`, exactly as /v2/inbox is.
//
// A SEPARATE SCREEN FROM /v2/inbox, not a replacement for it — and that is a decision worth stating.
// /v2/inbox is the reskin of the existing inbox: every conversation, calls included, filtered by
// channel. This is the messages employee's own surface: three approval states, no calls, and a row
// that expands into a draft. Merging them would mean deleting an approved screen to make room for a
// feature that is not finished, so both exist until that call is made deliberately.

export const dynamic = 'force-dynamic'

export default async function V2Messages() {
  const { tenantId } = await listPageContext('inbox')

  // Miles if he has been hired, otherwise the tenant's default agent — the screen still has to say
  // something true about who answered, and every message today was answered by that agent.
  const db = createAdminClient()
  const miles = await agentByPersona<{ id: string; name: string | null; persona: string | null }>(
    db, tenantId, 'miles', 'id, name, persona',
  )
  const agent = miles ?? (await primaryAgent<{ name: string | null; persona: string | null }>(db, tenantId, 'name, persona'))
  const agentName = miles ? nameOf(miles) : agent ? nameOf(agent) : PERSONAS.miles.name

  const data = await readMilesInbox(tenantId, agentName)
  return <MessagesClient data={data} />
}
