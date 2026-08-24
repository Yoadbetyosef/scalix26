import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { OrderForm } from '@/components/orders/order-form'

export const dynamic = 'force-dynamic'

export default async function NewOrderPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
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
      <OrderForm />
    </div>
  )
}
