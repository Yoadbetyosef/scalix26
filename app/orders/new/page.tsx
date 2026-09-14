import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { OrderForm } from '@/components/orders/order-form'
import { createAdminClient } from '@/lib/supabase/server'
import type { PickedContact } from '@/components/orders/contact-picker'
import { getSchemaCapabilities } from '@/lib/db/capabilities'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ contact?: string }> }) {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  // Arriving from a customer's page with ?contact=<id>: the customer is filled in and LINKED, so a
  // repeat order for a known person is the items and nothing else. Tenant-scoped, and an unknown id
  // simply yields an empty form.
  const { contact: contactId } = await searchParams
  let prefill: PickedContact | null = null
  if (contactId && /^[0-9a-f-]{36}$/i.test(contactId)) {
    const { data: c } = await createAdminClient().from('contacts').select('*').eq('tenant_id', a.tenantId).eq('id', contactId).maybeSingle()
    if (c) {
      prefill = {
        id: c.id as string, name: (c.name as string) ?? '', company: (c.company_name as string) ?? '',
        email: (c.email as string) ?? '', phone: (c.phone as string) ?? '', address: (c.address as string) ?? '',
        currency: (c.currency as string) || 'usd',
      }
    }
  }
  return (
    <div className="v2 v2-embedded mx-auto max-w-4xl p-4 sm:p-6">
      {/* Back is the kit's round icon button and the title is the micro-label — the same header
          /inbox/[id] and /contacts/[id] use. A 24px "New Order" over a rail that says Orders is the
          page header this language dropped everywhere else. */}
      <div className="v2-head">
        <Link href="/orders" className="v2-ico tap-target" aria-label="Back to orders"><ArrowLeft /></Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />New order</p>
        <s />
      </div>
      <OrderForm initialCustomer={prefill} supportsKinds={(await getSchemaCapabilities()).orderKinds} />
    </div>
  )
}
