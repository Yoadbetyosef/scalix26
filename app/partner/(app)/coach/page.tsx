import { getPartnerContext } from '@/lib/partner/rbac'
import { getPartnerStatsCached } from '@/lib/partner/stats'
import { getCoach } from '@/lib/partner/coach'
import { PageHeader, Panel, CoachIcon } from '@/components/partner/ui'
import { OutreachWriter } from '@/components/partner/outreach-writer'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CoachPage() {
  const ctx = await getPartnerContext()
  if (!ctx) return null
  const stats = await getPartnerStatsCached(ctx.partnerId)
  const coach = await getCoach(ctx.partnerId, stats)

  return (
    <div>
      <PageHeader title="AI Sales Coach" subtitle="Your personal sales manager — what to do next, and the words to say." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Recommended next actions">
          <div className="space-y-2.5">
            {coach.cards.map((c, i) => (
              <div key={i} className={`rounded-xl border p-3 ${c.tone === 'win' ? 'border-green-200 bg-green-50/50' : c.tone === 'action' ? 'border-accent/25 bg-accent/5' : 'border-hairline bg-surface'}`}>
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-accent-strong"><CoachIcon name={c.icon} className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink">{c.title}</div>
                    {c.body && <div className="mt-0.5 text-sm text-subtle">{c.body}</div>}
                    {c.cta && c.href && <Link href={c.href} className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline">{c.cta} <ArrowRight className="h-3.5 w-3.5" /></Link>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <OutreachWriter />
      </div>
    </div>
  )
}
