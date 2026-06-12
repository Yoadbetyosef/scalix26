'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

/**
 * Subscribes to new leads for the signed-in user's tenant via Supabase Realtime.
 * Pops a toast for every new lead (e.g. a hot lead the AI captured on a voice
 * call) and returns the live count of open leads (new/contacted) for a nav badge.
 *
 * Mounted from the Sidebar, so it runs on every authenticated page.
 */
export function useLeadNotifications() {
  const [openLeads, setOpenLeads] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('user_id', user.id)
        .single()
      if (!tenant) return

      // Initial badge count: leads that still need follow-up.
      const { count } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'contacted'])
        .eq('tenant_id', tenant.id)
      setOpenLeads(count || 0)

      channel = supabase
        .channel('leads-realtime')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenant.id}` },
          (payload) => {
            const lead = payload.new as { name?: string | null; phone?: string | null; source?: string | null }
            setOpenLeads((n) => n + 1)
            toast.custom(
              () => (
                <div className="bg-white border-l-4 border-red-500 p-4 shadow-lg rounded-lg flex items-start gap-3">
                  <span className="text-2xl">🔔</span>
                  <div>
                    <p className="font-bold text-gray-900">New Lead!</p>
                    <p className="text-sm text-gray-600">
                      {lead.name || 'Unknown'} — {lead.phone}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Source: {lead.source}</p>
                  </div>
                </div>
              ),
              { duration: 8000 },
            )
          },
        )
        .subscribe()
    })()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  return openLeads
}
