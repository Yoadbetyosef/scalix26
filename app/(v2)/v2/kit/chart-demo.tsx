'use client'

import { BarChart, Bar, Cell, CartesianGrid, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTip, ChartGradient } from '@/components/v2/chart-tip'
import { channelHue } from '@/app/(v2)/v2/channels'

// THE CHART PAIR, both halves, on the same real 14-day window and the same real channel counts.
// Client-only because recharts measures the DOM.

export function ChartV1({ days, channels }: { days: { date: string; count: number }[]; channels: { channel: string; count: number }[] }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ border: '1px solid #e4e4e7', borderRadius: 12, background: '#fff', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 10, background: '#3b82f6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>↗</span>
          <b style={{ fontSize: 15 }}>Conversations Over Time</b>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={days}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#5B6CF0" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ border: '1px solid #e4e4e7', borderRadius: 12, background: '#fff', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 32, height: 32, borderRadius: 10, background: '#8b5cf6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 15 }}>▥</span>
          <b style={{ fontSize: 15 }}>Channel Distribution</b>
        </div>
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={channels} barSize={28}>
            <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="#5B6CF0" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function ChartV2({ days, channels }: { days: { date: string; count: number }[]; channels: { channel: string; count: number }[] }) {
  return (
    <div style={{ display: 'grid', gap: 30 }}>
      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />Conversations, day by day</p><s /></div>
        {/* The one line on the screen is the screen's subject, so it takes the signature gradient —
            and because a CSS gradient cannot paint an SVG stroke, that means a real <linearGradient>. */}
        <div className="v2-chart">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <ChartGradient id="kit-line" />
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" interval="preserveStartEnd" />
              <YAxis width={40} allowDecimals={false} />
              <Tooltip content={<ChartTip />} />
              <Line type="monotone" dataKey="count" stroke="url(#kit-line)" strokeWidth={2} dot={false} activeDot={{ r: 3, strokeWidth: 0, fill: 'var(--v2-t3)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}><i />Where it came from</p><s /></div>
        {/* Each bar in its own channel's hue — the same hue that channel's chip carries in the inbox,
            the contacts table and the employee card. No legend: the axis names every column. */}
        <div className="v2-chart">
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={channels} barSize={26} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="channel" />
              <YAxis width={40} allowDecimals={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--v2-hover)' }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {channels.map((c) => <Cell key={c.channel} fill={channelHue(c.channel)} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}
