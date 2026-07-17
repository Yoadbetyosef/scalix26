import { NextRequest, NextResponse } from 'next/server'
import { requireActiveBusinessContext } from '@/lib/workspace'
import { verifyState } from '@/lib/quickbooks/state'
import { completeConnection } from '@/lib/quickbooks/connection'

// OAuth redirect target. Verifies the signed state against the authenticated tenant, exchanges the code,
// stores the encrypted tokens, and returns the user to where they started (onboarding agent page, or the
// commerce settings page) with a ?qb= result.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const st = verifyState(url.searchParams.get('state'), Date.now())
  const agentId = st?.ret || ''
  const back = new URL(agentId ? `/ai-employees/${agentId}` : '/ai-employees', req.url)
  const finish = (result: string) => { back.searchParams.set('qb', result); return NextResponse.redirect(back) }

  const c = await requireActiveBusinessContext()
  if (!c?.tenantId) return finish('error')
  if (url.searchParams.get('error')) return finish('denied') // user declined consent

  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  if (!code || !realmId || !st || st.tenantId !== c.tenantId) return finish('error')

  const r = await completeConnection(c.tenantId, realmId, code, c.actorUserId)
  return finish(r.ok ? 'connected' : 'error')
}
