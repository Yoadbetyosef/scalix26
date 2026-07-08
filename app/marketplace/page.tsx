import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import { Store, Award, MapPin } from 'lucide-react'

export const dynamic = 'force-dynamic'

// Public directory of certified partners. No auth.
export default async function MarketplaceDirectory() {
  const db = createAdminClient()
  const { data: profiles } = await db.from('marketplace_profiles')
    .select('partner_id, headline, bio, specialties, regions, logo_url, rating_avg, review_count, partners(slug, company_name, partner_type, health_score)')
    .eq('listed', true).order('rating_avg', { ascending: false, nullsFirst: false }).limit(200)

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10 text-accent-strong"><Store className="h-6 w-6" /></div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Find a Scalix26 Partner</h1>
          <p className="mx-auto mt-2 max-w-lg text-subtle">Certified experts who set up and manage AI employees for businesses like yours.</p>
        </div>

        {!profiles || profiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-12 text-center text-muted">No listed partners yet — check back soon.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => {
              const partner = p.partners as unknown as { slug: string; company_name: string | null; partner_type: string } | null
              if (!partner) return null
              return (
                <Link key={p.partner_id} href={`/marketplace/${partner.slug}`} className="flex flex-col rounded-2xl border border-hairline bg-surface p-5 shadow-e1 transition-shadow hover:shadow-e2">
                  <div className="mb-3 flex items-center gap-3">
                    {p.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.logo_url} alt="" className="h-11 w-11 rounded-xl object-contain" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-lg font-bold text-accent-strong">{(partner.company_name || 'P').charAt(0)}</div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">{partner.company_name || 'Partner'}</div>
                      <div className="flex items-center gap-1 text-xs text-accent-strong"><Award className="h-3 w-3" /> Certified Partner</div>
                    </div>
                  </div>
                  {p.headline && <div className="text-sm font-medium text-ink">{p.headline}</div>}
                  {p.bio && <div className="mt-1 line-clamp-2 flex-1 text-sm text-subtle">{p.bio}</div>}
                  {p.specialties?.length ? <div className="mt-2 flex flex-wrap gap-1">{p.specialties.slice(0, 3).map((s: string) => <span key={s} className="rounded-full bg-sunken px-2 py-0.5 text-xs text-subtle">{s}</span>)}</div> : null}
                  {p.regions?.length ? <div className="mt-2 flex items-center gap-1 text-xs text-muted"><MapPin className="h-3 w-3" /> {p.regions.join(', ')}</div> : null}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
