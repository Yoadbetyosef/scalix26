'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// Canonical channel colors — consistent with the channel tiles across the app.
const CHANNEL_COLORS: Record<string, string> = {
  voice: '#06b6d4',
  sms: '#10b981',
  email: '#8b5cf6',
  whatsapp: '#22c55e',
  facebook: '#2563eb',
  instagram: '#ec4899',
}

interface Conversation {
  channel: string
}

export function ChannelDistributionChart({ conversations }: { conversations: Conversation[] }) {
  const counts = conversations.reduce<Record<string, number>>((acc, conv) => {
    if (conv.channel === 'whatsapp') return acc // WhatsApp removed from the UI
    acc[conv.channel] = (acc[conv.channel] || 0) + 1
    return acc
  }, {})

  const data = Object.entries(counts).map(([channel, count]) => ({ channel, count }))

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted text-sm">
        No channel data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barSize={32}>
        <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] || '#5B6CF0'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
