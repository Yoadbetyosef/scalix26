import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { requireOrdersAccess } from '@/lib/orders/guard'
import { MemoForm } from '@/components/memos/memo-form'

export const dynamic = 'force-dynamic'

export default async function NewMemoPage() {
  const a = await requireOrdersAccess()
  if (!a) notFound()
  return (
    <div className="v2 v2-embedded mx-auto max-w-4xl p-4 sm:p-6">
      <div className="v2-head">
        <Link href="/orders/memos" className="v2-ico tap-target" aria-label="Back to memos"><ArrowLeft /></Link>
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />New memo</p>
        <s />
      </div>
      <MemoForm />
    </div>
  )
}
