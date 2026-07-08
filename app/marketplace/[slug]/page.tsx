import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { Award, MapPin, Globe, Star, ArrowLeft } from 'lucide-react'
import { ReviewForm } from '@/components/partner/review-form'

export const dynamic = 'force-dynamic'

export default async function PartnerProfile({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = createAdminClient()
  const { data: partner } = await db.from('partners').select('id, company_name, partner_type, created_at').eq('slug', slug).maybeSingle()
  if (!partner) notFound()
  const { data: profile } = await db.from('marketplace_profiles').select('*').eq('partner_id', partner.id).eq('listed', true).maybeSingle()
  if (!profile) notFound()
  const [{ data: reviews }, { count: customerCount }, { data: certs }, { data: badges }] = await Promise.all([
    db.from('marketplace_reviews').select('rating, body, created_at').eq('partner_id', partner.id).eq('status', 'published').order('created_at', { ascending: false }).limit(20),
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partner.id).eq('status', 'paid'),
    db.from('certifications').select('badge').eq('partner_id', partner.id),
    db.from('partner_xp_events').select('label').eq('partner_id', partner.id).like('kind', 'ach:%').not('label', 'is', null),
  ])
  const yearsWith = Math.max(0, Math.floor((Date.now() - new Date(partner.created_at).getTime()) / (365 * 86400000)))
  const badgeLabels = Array.from(new Set([...(certs || []).map((c) => c.badge).filter(Boolean), ...(badges || []).map((b) => b.label).filter(Boolean)])) as string[]

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <Link href="/marketplace" className="mb-6 inline-flex items-center gap-1 text-sm text-subtle hover:text-ink"><ArrowLeft className="h-4 w-4" /> All partners</Link>

        <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-e1">
          <div className="flex items-center gap-4">
            {profile.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.logo_url} alt="" className="h-16 w-16 rounded-2xl object-contain" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-2xl font-bold text-accent-strong">{(partner.company_name || 'P').charAt(0)}</div>
            )}
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{partner.company_name || 'Partner'}</h1>
              <div className="flex items-center gap-1 text-sm text-accent-strong"><Award className="h-4 w-4" /> Certified Scalix26 Partner</div>
            </div>
          </div>

          {profile.headline && <p className="mt-4 text-lg text-ink">{profile.headline}</p>}
          {profile.bio && <p className="mt-2 text-subtle">{profile.bio}</p>}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-subtle">
            {profile.regions?.length ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {profile.regions.join(', ')}</span> : null}
            {profile.website ? <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-strong hover:underline"><Globe className="h-4 w-4" /> Website</a> : null}
          </div>

          {/* Stat strip */}
          <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-sunken/50 p-3 text-center sm:grid-cols-4">
            <div><div className="text-lg font-semibold text-ink">{customerCount ?? 0}</div><div className="text-xs text-muted">Customers</div></div>
            <div><div className="text-lg font-semibold text-ink">{profile.projects_completed || 0}</div><div className="text-xs text-muted">Projects</div></div>
            <div><div className="text-lg font-semibold text-ink">{profile.rating_avg ? `${profile.rating_avg}★` : '—'}</div><div className="text-xs text-muted">{profile.review_count || 0} reviews</div></div>
            <div><div className="text-lg font-semibold text-ink">{profile.response_time || (yearsWith >= 1 ? `${yearsWith}y` : 'New')}</div><div className="text-xs text-muted">{profile.response_time ? 'Response' : 'With Scalix'}</div></div>
          </div>

          {badgeLabels.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {badgeLabels.map((b) => <span key={b} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-strong"><Award className="h-3 w-3" /> {b}</span>)}
            </div>
          )}
          {(profile.languages?.length || profile.countries?.length) ? (
            <div className="mt-3 text-sm text-subtle">
              {profile.languages?.length ? <span>Languages: {profile.languages.join(', ')}. </span> : null}
              {profile.countries?.length ? <span>Serves: {profile.countries.join(', ')}.</span> : null}
            </div>
          ) : null}

          {profile.specialties?.length ? (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {profile.specialties.map((s: string) => <span key={s} className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-subtle">{s}</span>)}
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <ReviewForm partnerSlug={slug} />
        </div>

        {reviews && reviews.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 font-semibold text-ink">Reviews</h2>
            <div className="space-y-3">
              {reviews.map((r, i) => (
                <div key={i} className="rounded-2xl border border-hairline bg-surface p-4">
                  <div className="flex gap-0.5">{Array.from({ length: 5 }).map((_, s) => <Star key={s} className={`h-4 w-4 ${s < r.rating ? 'fill-amber-400 text-amber-400' : 'text-hairline-strong'}`} />)}</div>
                  {r.body && <p className="mt-1.5 text-sm text-subtle">{r.body}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
