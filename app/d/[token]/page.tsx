import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { DOC_META, docNumber, hexColor, type StudioDocument } from '@/lib/studio/types'
import { PrintButton } from '@/components/studio/print-button'

export const dynamic = 'force-dynamic'

type Tenant = { business_name: string | null; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null }

async function resolve(token: string): Promise<{ doc: StudioDocument; tenant: Tenant } | null> {
  const db = createAdminClient()
  const { data: doc } = await db.from('studio_documents').select('*').eq('token', token).maybeSingle()
  if (!doc) return null
  const { data: tenant } = await db.from('tenants').select('business_name,email,phone,address,city,state,zip').eq('id', doc.tenant_id).maybeSingle()
  return { doc: doc as StudioDocument, tenant: (tenant as Tenant) || { business_name: null, email: null, phone: null, address: null, city: null, state: null, zip: null } }
}


// ── THE PAGE TITLE IS THE TENANT'S, AND ONLY THE TENANT'S ───────────────────────────────────────────
//
// Chrome prints document.title at the top of every printed page. This route used to inherit the root
// layout's "<platform> — AI Employee Platform", so every estimate a customer received had our name
// printed across the top of it. The title is the tenant's business name and the document's own
// identity; nothing else belongs in it, because a customer reading it is not our customer.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  try {
    const r = await resolve((await params).token)
    if (!r) return { title: '' }
    const meta = DOC_META[r.doc.type]
    return {
      title: [r.tenant.business_name, meta?.title].filter(Boolean).join(' \u00b7 '),
      robots: { index: false, follow: false },
    }
  } catch {
    return { title: '' }
  }
}

const money = (n: number, cur: string) => `${cur === 'usd' ? '$' : ''}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function PublicDocumentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const data = await resolve(token)
  if (!data) notFound()
  const { doc, tenant } = data
  const meta = DOC_META[doc.type]
  const isProduction = doc.type === 'production'
  const dateStr = new Date(doc.created_at).toISOString().slice(0, 10)
  const addr = [tenant.address, [tenant.city, tenant.state, tenant.zip].filter(Boolean).join(', ')].filter(Boolean)
  // The brand colour snapshot on the document (re-validated — never inline an untrusted value into style).
  const accent = hexColor(doc.accent_color)

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white px-6 py-10 text-neutral-900 print:py-4">
      {/* printColorAdjust so the brand bar survives the browser's print default of dropping backgrounds */}
      {accent && <div className="mb-6 h-1.5 w-full rounded-full print:mb-4" style={{ background: accent, WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }} />}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          {/* The wordmark renders ONCE.
              
              This was a logo <img> followed by an <h1> of the same business name, so every tenant
              whose logo contains their name — which is most brand logos — had it printed twice on
              every document. A logo IS the name; if one exists it stands alone, and the name is
              carried by the img's alt text for anyone who cannot see it. */}
          {doc.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={doc.logo_url} alt={tenant.business_name || ''} className="mb-2 h-12 w-auto max-w-[180px] object-contain" />
            : <h1 className="text-2xl font-bold tracking-tight">{tenant.business_name || 'Studio'}</h1>}
          {addr.map((l, i) => <p key={i} className="text-sm text-neutral-500">{l}</p>)}
          <p className="text-sm text-neutral-500">{[tenant.email, tenant.phone].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold uppercase tracking-wide text-neutral-800" style={accent ? { color: accent } : undefined}>{meta.title}</p>
          <p className="text-sm text-neutral-500">#{docNumber(doc)}</p>
          <p className="text-sm text-neutral-500">{dateStr}</p>
          {doc.valid_until && doc.type === 'quote' && <p className="text-sm text-neutral-500">Valid until {doc.valid_until}</p>}
        </div>
      </div>

      {(doc.party_name || doc.party_email) && (
        <div className="mb-6 rounded-lg border border-neutral-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{meta.party}</p>
          <p className="text-sm font-medium">{doc.party_name}</p>
          {doc.party_email && <p className="text-sm text-neutral-500">{doc.party_email}</p>}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-300 text-left text-xs uppercase tracking-wide text-neutral-500" style={accent ? { borderBottomColor: accent } : undefined}>
            <th className="py-2">Item</th>
            <th className="py-2 text-center">Qty</th>
            {!isProduction && <th className="py-2 text-right">Unit</th>}
            {!isProduction && <th className="py-2 text-right">Total</th>}
          </tr>
        </thead>
        <tbody>
          {doc.line_items.map((l, i) => (
            <tr key={i} className="border-b border-neutral-100 align-top">
              <td className="py-2.5">
                <div className="flex gap-3">
                  {l.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.image} alt="" className="h-14 w-14 flex-shrink-0 rounded-md border border-neutral-200 object-cover" />
                  )}
                  <div className="min-w-0">
                    <span className="font-medium">{l.name}</span>
                    {l.fabric && <span className="block text-xs text-neutral-500">{l.fabric}</span>}
                    {l.desc && <span className="block text-xs text-neutral-500">{l.desc}</span>}
                    {l.sku && <span className="block text-xs text-neutral-400">SKU {l.sku}</span>}
                  </div>
                </div>
              </td>
              <td className="py-2.5 text-center">{l.qty}</td>
              {!isProduction && <td className="py-2.5 text-right">{l.unit_price != null ? money(l.unit_price, doc.currency) : '—'}</td>}
              {!isProduction && <td className="py-2.5 text-right">{l.unit_price != null ? money(l.unit_price * l.qty, doc.currency) : '—'}</td>}
            </tr>
          ))}
        </tbody>
        {!isProduction && (
          <tfoot>
            <tr>
              <td colSpan={3} className="py-3 text-right text-sm font-medium text-neutral-500">Subtotal</td>
              <td className="py-3 text-right text-lg font-bold" style={accent ? { color: accent } : undefined}>{money(doc.subtotal, doc.currency)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {doc.notes && (
        <div className="mt-6">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Notes</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700">{doc.notes}</p>
        </div>
      )}

      {doc.terms && (
        <div className="mt-6 border-t border-neutral-100 pt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Terms</p>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-500">{doc.terms}</p>
        </div>
      )}

      {doc.type === 'invoice' && (
        <p className="mt-8 text-xs text-neutral-400">Payment instructions to be provided by {tenant.business_name || 'the studio'}.</p>
      )}

      <div className="mt-10 print:hidden"><PrintButton /></div>
    </main>
  )
}
