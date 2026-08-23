import { notFound } from 'next/navigation'
import { RudiPresenceProvider } from '@/components/dashboard/hero/rudi-presence'
import { RudiBand } from '@/components/dashboard/hero/rudi-band'

// The band in a v1 page's CSS environment and a v1 page's padding, which is the only place its
// full-bleed negative margin means anything. Dev only. See ../orb/page.tsx.
//
//   ?mode=phone   the shipped composition
//   ?mode=wide    the band full container width — what a desktop band would be if simply un-hidden
//   ?mode=column  the band held to a column, with the copy beside it
//
// AttentionSentence reads a context the dashboard seeds from the server, so the sentence here is a
// stand-in of the same size, weight and colour, to judge the composition.

export const dynamic = 'force-dynamic'

const SENTENCE = '3 new people today, 1 handled. One thing needs you.'

export default async function BandProbe({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { mode = 'phone' } = await searchParams

  return (
    <RudiPresenceProvider>
      <div className="p-4 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-start justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
              <p className="mt-0.5 truncate text-sm text-muted">T.G. Jewellers</p>
            </div>
            <span className="ml-3 inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Rudi on duty
            </span>
          </div>

          {mode === 'column' ? (
            // The v2 desktop hero's own idea, brought over: he does not take the full width, he takes
            // a column of it, and the copy sits beside him instead of under him.
            <div className="grid grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-center gap-8">
              <RudiBand />
              <div>
                <p className="text-sm text-subtle">Rudi · AI Employee · T.G. Jewellers</p>
                <h2 className="mt-2 max-w-xl text-balance text-2xl font-light leading-snug tracking-tight text-ink">{SENTENCE}</h2>
              </div>
            </div>
          ) : (
            <>
              <div className={mode === 'wide' ? '' : 'md:hidden'}>
                <RudiBand />
              </div>
              <h2 className="mt-4 max-w-xl text-balance text-xl font-light leading-snug tracking-tight text-ink">{SENTENCE}</h2>
            </>
          )}

          <div className="mt-6 grid gap-x-10 gap-y-4 lg:grid-cols-2">
            <div className="rounded-xl border border-hairline p-4 text-sm text-muted">Talk to Rudi — AskAmy sits here</div>
            <div className="rounded-xl border border-hairline p-4 text-sm text-muted">Today&rsquo;s numbers sit here</div>
          </div>
        </div>
      </div>
    </RudiPresenceProvider>
  )
}
