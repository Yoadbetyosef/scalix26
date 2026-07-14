import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { getSupportOps } from '@/lib/command-center/ops-adapters'
import { compactMoney, num, pctText, Section } from '@/components/command-center/ui'
import { MetricStat } from '@/components/command-center/metric-ui'
import { SupportQueue } from '@/components/command-center/support-queue'

export const dynamic = 'force-dynamic'

function WaitingCard({ label, needs }: { label: string; needs: string }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline-strong bg-sunken/40 p-4">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium uppercase tracking-wide text-subtle">{label}</span><span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">No source</span></div>
      <div className="mt-1 text-lg font-semibold text-subtle">Waiting for Data</div>
      <div className="mt-1 text-[11px] leading-tight text-subtle">{needs}</div>
    </div>
  )
}

// Support & Operations — an Operational Support PROXY, not a ticket system (there isn't one). Every figure is
// derived from real operational metadata (conversation status/human-takeover, message-delivery failures,
// channel health) — never message content. Raw "open conversations" are a tenant end-customer product-usage
// signal and are shown separately, NOT counted as Scalix support demand.
export default async function SupportOpsPage() {
  const founder = await getFounderContext()
  if (!founder) notFound()
  const { ops, queue } = await getSupportOps()

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-ink">Support &amp; Operations</h2>
        <p className="text-sm text-subtle">Operational Support Proxy — derived from real conversation/message/channel status. No ticket system exists yet, so this is honest signal, not tickets. Conversation <em>content</em> is never shown here.</p>
      </div>

      <Section title="Actionable operational load" subtitle="Support incidents: human takeovers + delivery/channel failures. Raw open conversations (tenant usage) and the SMS provisioning backlog are excluded.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Actionable incidents" m={ops.actionableDemand} format={(v) => num(v)} />
          <MetricStat label="Human takeovers" m={ops.humanTakeoverLoad} format={(v) => num(v)} />
          <MetricStat label="Message failures" m={ops.messageFailureLoad} format={(v) => num(v)} />
          <MetricStat label="Channels down" m={ops.channelDownLoad} format={(v) => num(v)} />
          <MetricStat label="SMS pending verification" m={ops.provisioningLoad} format={(v) => num(v)} />
          <MetricStat label="Demand hours" m={ops.demandHours} format={(v) => `${v.toFixed(1)}h`} />
          <MetricStat label="Support utilization" m={ops.utilization} format={(v) => pctText(v)} />
          <MetricStat label="SLA at risk" m={ops.slaAtRisk} format={(v) => num(v)} />
        </div>
      </Section>

      <Section title="Impact & inflow" subtitle="Who is affected and how much new operational demand is arriving.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricStat label="Customers affected" m={ops.customersAffected} format={(v) => num(v)} />
          <MetricStat label="Paying MRR affected" m={ops.payingMrrAffectedCents} format={(v) => compactMoney(v)} />
          <MetricStat label="Trials affected" m={ops.trialsAffected} format={(v) => num(v)} />
          <MetricStat label="Open conversations (usage)" m={ops.openConversationLoad} format={(v) => num(v)} />
          <MetricStat label="New today" m={ops.newToday} format={(v) => num(v)} />
          <MetricStat label="New (7d)" m={ops.new7d} format={(v) => num(v)} />
          <MetricStat label="New (30d)" m={ops.new30d} format={(v) => num(v)} />
          <MetricStat label="Available support hours" m={ops.availableHours} format={(v) => `${v.toFixed(0)}h`} />
        </div>
      </Section>

      <Section title="Waiting for data" subtitle="No reliable source yet — never substituted with a guess.">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <WaitingCard label="Failed calls" needs="No call-outcome/log table exists. Instrument voice call results to derive this." />
          <WaitingCard label="Ticket SLA" needs="No ticket system. SLA-at-risk above is an open-duration Estimate only." />
        </div>
      </Section>

      {(ops.byIssue.length > 0 || ops.byChannel.length > 0) && (
        <Section title="Top operational categories" subtitle="Derived from channel/signal; manual reclassification available in the queue.">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="overflow-x-auto rounded-xl border border-hairline-strong">
              <table className="min-w-full text-sm"><thead className="bg-sunken text-subtle"><tr>{['Issue', 'Count', 'Derived %'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-hairline">{ops.byIssue.slice(0, 8).map((i) => <tr key={i.issue}><td className="px-3 py-2 capitalize text-ink">{i.issue.replace(/_/g, ' ')}</td><td className="px-3 py-2 tabular-nums">{i.count}</td><td className="px-3 py-2 tabular-nums text-subtle">{Math.round(i.derivedShare * 100)}%</td></tr>)}</tbody>
              </table>
            </div>
            <div className="overflow-x-auto rounded-xl border border-hairline-strong">
              <table className="min-w-full text-sm"><thead className="bg-sunken text-subtle"><tr>{['Channel', 'Actionable count'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-hairline">{ops.byChannel.slice(0, 8).map((c) => <tr key={c.channel}><td className="px-3 py-2 capitalize text-ink">{c.channel}</td><td className="px-3 py-2 tabular-nums">{c.count}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        </Section>
      )}

      <Section title="Operational queue" subtitle="Actionable items, most severe first. Assign an owner, classify, and resolve. Deep-links open the source record in the app — no content is copied here.">
        <SupportQueue rows={queue} />
      </Section>
    </div>
  )
}
