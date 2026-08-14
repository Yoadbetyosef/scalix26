import { createAdminClient } from '@/lib/supabase/server'
import { agentByPersona, primaryAgent } from '@/lib/agents/primary'
import { nameOf, PERSONAS } from '@/lib/persona'
import { readMilesInbox } from '@/lib/miles/inbox-read'
import { listPageContext } from '../list-page'
import { InboxGroups } from './groups'

// THE INBOX. Three groups, three states, every channel.
//
// This used to be the reskinned conversation list — one filtered list of everything, with chips for
// calls and messages. It is now sorted by what each thread NEEDS rather than by where it arrived,
// because that is the only question somebody opening an inbox is asking. Calls sit in the handled
// group beside the messages, and each row names the employee who took it.
//
// Gated on `inbox`, exactly as it was.

export const dynamic = 'force-dynamic'

export default async function V2Inbox() {
  const { tenantId } = await listPageContext('inbox')

  // Miles if he has been hired, otherwise the tenant's default agent — the screen still has to say
  // something true about who answered, and every conversation here was answered by somebody.
  const db = createAdminClient()
  const miles = await agentByPersona<{ id: string; name: string | null; persona: string | null }>(
    db, tenantId, 'miles', 'id, name, persona',
  )
  const agent = miles ?? (await primaryAgent<{ name: string | null; persona: string | null }>(db, tenantId, 'name, persona'))
  const agentName = miles ? nameOf(miles) : agent ? nameOf(agent) : PERSONAS.miles.name

  const data = await readMilesInbox(tenantId, agentName)
  // The panel is Miles's. Without him there is no portrait to show and no employee to talk to, so the
  // screen is the three groups and nothing else.
  return <InboxGroups data={data} milesId={miles?.id ?? null} />
}
