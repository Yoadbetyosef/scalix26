import { redirect } from 'next/navigation'
import { getActiveWorkspace } from '@/lib/workspace'
import { readSettings } from '@/lib/settings/read'
import { SettingsClient } from './client'

// The tenant's own settings — the account, not an agent. readSettings is the /settings page's own
// read, extracted verbatim, so this adds no query.
//
// hideBilling comes from the workspace MODE, exactly as the real page derives it: a White Label
// client's plan is governed by the partner, never Scalix Stripe, so in operator mode the plan and the
// portal are ABSENT rather than disabled. A disabled upgrade button would tell a client they could
// upgrade here if only they were allowed; there is nothing for them to do, so there is nothing to show.

export const dynamic = 'force-dynamic'

export default async function V2Settings() {
  const ws = await getActiveWorkspace()
  if (!ws.tenantId) redirect('/auth/signup')
  const data = await readSettings(ws.tenantId)
  if (!data) redirect('/auth/signup')

  return <SettingsClient tenant={data.tenant} channels={data.channels} hideBilling={ws.mode === 'operator'} />
}
