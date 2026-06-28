'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { createClient } from '@/lib/supabase/client'

const COLORS = ['#5B6CF0', '#1a1f36']

export function ConversationDistributionChart({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState([
    { name: 'AI Handled', value: 0 },
    { name: 'Transferred', value: 0 },
  ])

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const [{ count: resolved }, { count: open }] = await Promise.all([
        supabase.from('conversations').select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'resolved').gte('created_at', sevenDaysAgo),
        supabase.from('conversations').select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId).eq('status', 'open').gte('created_at', sevenDaysAgo),
      ])

      setData([
        { name: 'AI Handled', value: resolved || 0 },
        { name: 'Transferred', value: open || 0 },
      ])
    }
    load()
  }, [tenantId])

  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
        No conversation data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value">
          {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
        </Pie>
        <Tooltip formatter={(v) => [v, '']} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}
