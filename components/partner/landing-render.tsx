import { parseVideo } from '@/lib/partner/media'

// Presentational landing page — shared by the public /l/[slug] route (server) and the in-app live
// preview (client). Pure: no hooks, no handlers (CTA is a plain link).
export interface LandingConfig {
  headline: string
  subhead?: string | null
  ctaText: string
  ctaHref: string
  accent?: string
  logoUrl?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  features?: string[]
  socialProof?: string | null
}

const DEFAULT_SUB = 'An AI employee that learns your business, answers every call and message 24/7, follows up with every lead, and tells you exactly what to do next to win more customers.'
const DEFAULT_FEATURES = ['Answers calls, texts & messages 24/7', 'Follows up automatically so no lead slips', 'Books appointments & captures every opportunity', 'Recommends the next best action every day']

export function LandingRender({ c }: { c: LandingConfig }) {
  const accent = c.accent || '#5B6CF0'
  const features = (c.features && c.features.length ? c.features : DEFAULT_FEATURES).filter(Boolean)
  const v = c.videoUrl ? parseVideo(c.videoUrl) : null

  return (
    <div className="min-h-full bg-canvas">
      <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-12 text-center sm:py-16">
        {c.logoUrl ? <img src={c.logoUrl} alt="logo" className="mb-6 h-10 object-contain" /> : <span className="mb-5 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium" style={{ background: `${accent}1a`, color: accent }}>Your AI employee</span>}

        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-5xl">{c.headline}</h1>
        <p className="mt-4 max-w-xl text-base text-subtle sm:text-lg">{c.subhead || DEFAULT_SUB}</p>

        <a href={c.ctaHref} className="mt-7 inline-flex h-12 items-center justify-center rounded-xl px-8 text-base font-semibold text-white shadow-e2 transition-transform active:scale-[0.98]" style={{ background: accent }}>{c.ctaText || 'Start free'}</a>

        {v?.embedUrl && v.provider !== 'file' && (
          <div className="mt-9 aspect-video w-full overflow-hidden rounded-2xl border border-hairline shadow-e1"><iframe src={v.embedUrl} className="h-full w-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen /></div>
        )}
        {v?.provider === 'file' && <video src={v.embedUrl!} controls className="mt-9 w-full rounded-2xl border border-hairline shadow-e1" />}
        {!v?.embedUrl && c.imageUrl && <img src={c.imageUrl} alt="" className="mt-9 w-full rounded-2xl border border-hairline object-cover shadow-e1" />}

        <ul className="mt-9 grid w-full gap-2 text-left sm:grid-cols-2">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2 rounded-xl border border-hairline bg-surface p-3 text-sm text-ink shadow-e1">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />{f}
            </li>
          ))}
        </ul>

        {c.socialProof && <p className="mt-8 max-w-xl text-sm italic text-subtle">“{c.socialProof}”</p>}

        <div className="mt-9 w-full rounded-2xl border border-hairline bg-surface p-5 shadow-e1">
          <div className="text-sm font-medium text-ink">Start in minutes</div>
          <p className="mt-1 text-xs text-subtle">Try a free, personalized demo — talk to your AI employee live.</p>
          <a href={c.ctaHref} className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-white" style={{ background: accent }}>{c.ctaText || 'Start free'}</a>
        </div>

        <p className="mt-10 text-xs text-muted">Powered by Scalix26</p>
      </div>
    </div>
  )
}
