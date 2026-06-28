'use client'

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, CheckCircle2, BarChart3 } from 'lucide-react'
import { format, subDays } from 'date-fns'

// Apple-style colored section tile for chart headers.
function ChartIcon({ icon: Icon, tone }: { icon: typeof TrendingUp; tone: string }) {
  return (
    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] ${tone} text-white shadow-e1`}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </span>
  )
}

interface Conversation {
  channel: string
  status: string
  created_at: string
  duration_seconds: number | null
}

// Canonical channel colors — consistent with the channel tiles across the app.
const CHANNEL_COLORS: Record<string, string> = {
  voice: '#06b6d4',     // cyan
  sms: '#10b981',       // emerald
  email: '#8b5cf6',     // violet
  whatsapp: '#22c55e',  // green
  facebook: '#2563eb',  // blue
  instagram: '#ec4899', // pink
}

export function AnalyticsCharts({ conversations }: { tenantId: string; conversations: Conversation[] }) {
  // Conversations over time (last 14 days)
  const last14Days = Array.from({ length: 14 }, (_, i) => {
    const date = subDays(new Date(), 13 - i)
    const dateStr = format(date, 'yyyy-MM-dd')
    const count = conversations.filter(c => c.created_at.startsWith(dateStr)).length
    return { date: format(date, 'MMM d'), count }
  })

  // Channel distribution
  const channelCounts = conversations.reduce<Record<string, number>>((acc, c) => {
    acc[c.channel] = (acc[c.channel] || 0) + 1
    return acc
  }, {})
  const channelData = Object.entries(channelCounts).map(([channel, count]) => ({ channel, count }))

  // Status distribution
  const statusCounts = conversations.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1
    return acc
  }, {})
  const statusData = [
    { name: 'AI Resolved', value: statusCounts['resolved'] || 0, color: '#10b981' },
    { name: 'Open', value: statusCounts['open'] || 0, color: '#3b82f6' },
    { name: 'Closed', value: statusCounts['closed'] || 0, color: '#ef4444' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><ChartIcon icon={TrendingUp} tone="bg-blue-500" /> Conversations Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={last14Days}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#5B6CF0"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><ChartIcon icon={CheckCircle2} tone="bg-emerald-500" /> Resolution Status</CardTitle>
        </CardHeader>
        <CardContent>
          {conversations.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} cx="50%" cy="50%" outerRadius={70} dataKey="value">
                  {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5"><ChartIcon icon={BarChart3} tone="bg-violet-500" /> Channel Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          {channelData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={channelData} barSize={28}>
                <XAxis dataKey="channel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {channelData.map((entry) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || '#5B6CF0'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
