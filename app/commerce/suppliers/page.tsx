import { notFound } from 'next/navigation'
import { requireCommerceAccess } from '@/lib/commerce/guard'
import { listSuppliers } from '@/lib/commerce/suppliers'
import { SupplierForm } from '@/components/commerce/supplier-form'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const c = await requireCommerceAccess(); if (!c) notFound()
  const suppliers = await listSuppliers()
  return (
    <div className="mx-auto max-w-5xl px-6 pb-10">
      <div className="mb-5 flex items-center justify-between">
        <div><h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1><p className="text-sm text-gray-500">{suppliers.length} supplier{suppliers.length === 1 ? '' : 's'}</p></div>
        <SupplierForm />
      </div>
      {suppliers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500">No suppliers yet. Add a factory/supplier to send Purchase Orders to.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {suppliers.map((s) => (
            <div key={s.id as string} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
              <span className="font-medium text-gray-900">{s.company_name as string}</span>
              {s.factory_name ? <span className="text-sm text-gray-500">· {s.factory_name as string}</span> : null}
              <span className="ml-auto text-xs text-gray-400">{(s.email as string) || 'no email'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
