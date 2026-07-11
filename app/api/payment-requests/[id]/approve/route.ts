import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { getConnectedAccountId } from '@/lib/stripe/connect'
import { createConnectCheckout } from '@/lib/stripe/payment-collection'
import { requestBaseUrl } from '@/lib/request-url'

// Owner approves a pending payment request → create the Checkout Session on the tenant's
// connected account and send the link. Money goes directly to the tenant.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: pr } = await admin.from('payment_requests').select('*').eq('id', id).maybeSingle()
  if (!pr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Authorize against the active workspace (owner tenant, or the client tenant a WL partner is operating).
  const activeTenantId = await getActiveTenantId()
  if (!activeTenantId || pr.tenant_id !== activeTenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { data: tenant } = await admin.from('tenants').select('id, business_name').eq('id', pr.tenant_id).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (pr.status !== 'pending') return NextResponse.json({ error: `Request is already ${pr.status}` }, { status: 409 })

  const acct = await getConnectedAccountId(pr.tenant_id)
  if (!acct) return NextResponse.json({ error: 'Stripe is not connected.' }, { status: 409 })

  try {
    const co = await createConnectCheckout(admin, {
      tenantId: pr.tenant_id,
      businessName: tenant.business_name || 'us',
      accountId: acct,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || requestBaseUrl(req),
      // product-as-is when there's a price_id and no explicit amount; otherwise custom/deposit amount.
      priceId: pr.amount == null ? pr.price_id : null,
      amount: pr.amount ?? null,
      productName: pr.product_name || 'Payment',
      currency: pr.currency || 'usd',
      recordAmount: pr.amount ?? null,
      customerEmail: pr.customer_email,
      customerPhone: pr.customer_phone,
      conversationId: pr.conversation_id,
      contactId: pr.contact_id,
    })
    await admin.from('payment_requests').update({
      status: 'sent', checkout_url: co.url, checkout_session_id: co.sessionId, decided_at: new Date().toISOString(),
    }).eq('id', id)
    return NextResponse.json({ ok: true, url: co.url, emailed: co.emailed })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not create payment link' }, { status: 500 })
  }
}
