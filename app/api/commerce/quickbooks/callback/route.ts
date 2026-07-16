import { NextRequest, NextResponse } from 'next/server'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { verifyState } from '@/lib/commerce/quickbooks/state'
import { completeConnection } from '@/lib/commerce/quickbooks/connection'

// OAuth redirect target. Verifies the signed state against the authenticated tenant (so a connection can
// only ever be bound to the tenant that started it), exchanges the code, and stores the encrypted tokens.
// Always lands back on the commerce settings page with a ?qb= result the UI turns into a banner.
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const back = new URL('/commerce/settings', req.url)
  const finish = (result: string) => { back.searchParams.set('qb', result); return NextResponse.redirect(back) }

  const c = await requireCommerceAccess()
  if (!c) return finish('error')
  if (url.searchParams.get('error')) return finish('denied') // user declined consent

  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  const stateTenant = verifyState(url.searchParams.get('state'), Date.now())
  if (!code || !realmId || !stateTenant || stateTenant !== c.tenantId) return finish('error')

  const r = await completeConnection(c.tenantId, realmId, code, c.actor)
  return finish(r.ok ? 'connected' : 'error')
}
