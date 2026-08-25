'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'
import { format, subDays } from 'date-fns'
import { ChartTip, ChartGradient } from '@/components/v2/chart-tip'
import { channelHue, channelKey, CHANNEL_LABEL } from '@/app/(v2)/v2/channels'

interface Conversation {
  channel: string
  status: string
  created_at: string
  duration_seconds: number | null
}

// THREE STATES, AND THE AI'S SHARE IS THE ONE THAT MATTERS. v1 coloured them emerald / blue / red,
// which reads as good / neutral / bad — but a closed conversation is not a failure, it is a finished
// one. Resolved takes the accent because it is the number the screen exists to report; the other two
// are shades of the same neutral, told apart by position and by the legend beside them.
const STATUS_HUE: Record<string, string> = {
  'AI resolved': 'var(--v2-t1)',
  Open: 'var(--v2-t4)',
  Closed: 'var(--v2-mute)',
}

export function AnalyticsCharts({ conversations }: { tenantId: string; conversations: Conversation[] }) {
  // Conversations over time (last 14 days)
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const date = subDays(new Date(), 13 - i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const count = conversations.filter(c => c.created_at.startsWith(dateStr)).length
    return { date: format(date, 'MMM d'), count }
  })
  const anyInWindow = last14Days.some((d) => d.count > 0)

  // Channel distribution. Keyed through channelKey so the labels and the hues are the same ones the
  // chips carry everywhere else, rather than a second spelling of "whatsapp" that colours differently.
  const channelCounts = conversations.reduce<Record<string, number>>((acc, c) => {
    const k = channelKey(c.channel)
    if (k) acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  const channelData = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, channel: CHANNEL_LABEL[key as keyof typeof CHANNEL_LABEL] ?? key, count }))

  // Status distribution
  const statusCounts = conversations.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1
    return acc
  }, {})
  const statusData = [
    { name: 'AI resolved', value: statusCounts['resolved'] || 0 },
    { name: 'Open', value: statusCounts['open'] || 0 },
    { name: 'Closed', value: statusCounts['closed'] || 0 },
  ].filter((s) => s.value > 0)
  const statusTotal = statusData.reduce((n, s) => n + s.value, 0)

  return (
    <div style={{ display: 'grid', gap: 34, marginTop: 34 }}>
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Conversations, day by day</p><s /></div>
        {/* A FORTNIGHT OF ZEROES IS NOT A CHART. v1 drew a flat line along the floor, which looks
            like a measurement and is the absence of one. */}
        {!anyInWindow ? (
          <div className="v2-card" data-empty>
            <b>Nothing in the last fortnight</b>
            <span>The moment someone calls, texts, emails or messages your business, the day it happened appears here.</span>
          </div>
        ) : (
          <div className="v2-chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={last14Days} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <ChartGradient id="an-line" />
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" interval="preserveStartEnd" />
                <YAxis width={40} allowDecimals={false} />
                <Tooltip content={<ChartTip />} />
                <Line type="monotone" dataKey="count" stroke="url(#an-line)" strokeWidth={2} dot={false}
                      activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--v2-t3)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gap: 34, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <section>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />How they ended</p><s /></div>
          {statusData.length === 0 ? (
            <div className="v2-card" data-empty>
              <b>Nothing to break down</b>
              <span>Once conversations start arriving, this shows how many the AI settled on its own.</span>
            </div>
          ) : (
            <>
              {/* A RING RATHER THAN A DISC, and the hole carries the total — a solid pie spends its
                  centre on nothing, and the one number a reader wants beside the proportions is what
                  they are proportions OF. */}
              <div className="v2-chart v2-ring">
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={54} outerRadius={78} paddingAngle={2} dataKey="value" stroke="none">
                      {statusData.map((e) => <Cell key={e.name} fill={STATUS_HUE[e.name]} />)}
                    </Pie>
                    <Tooltip content={<ChartTip labelFrom={(x) => x.name} />} />
                  </PieChart>
                </ResponsiveContainer>
                <span className="v2-ring-mid" aria-hidden>
                  <b>{statusTotal.toLocaleString()}</b>
                  <em>total</em>
                </span>
              </div>
              {/* The pie is the one shape whose axis cannot name its parts, so it is the one that
                  gets a legend. */}
              <div className="v2-clegend">
                {statusData.map((e) => (
                  <span key={e.name} style={{ ['--ghue' as string]: STATUS_HUE[e.name] }}>
                    <i />{e.name}<em>{statusTotal > 0 ? `${Math.round((e.value / statusTotal) * 100)}%` : '—'}</em>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>

        <section>
          <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Where it came from</p><s /></div>
          {channelData.length === 0 ? (
            <div className="v2-card" data-empty>
              <b>No channel has spoken yet</b>
              <span>Each channel you connect appears here as soon as it carries its first conversation.</span>
            </div>
          ) : (
            <div className="v2-chart">
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={channelData} barSize={26} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="channel" />
                  <YAxis width={40} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--v2-hover)' }} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {channelData.map((e) => <Cell key={e.key} fill={channelHue(e.key)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
