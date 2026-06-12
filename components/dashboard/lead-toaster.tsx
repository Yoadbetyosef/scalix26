'use client'

import { useEffect, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type LeadToast = {
  id: string
  name: string | null
  phone: string | null
  source: string | null
}

const AUTO_DISMISS_MS = 8000

/**
 * Facebook/Instagram-style new-lead notifications. Subscribes to the tenant's
 * leads INSERTs via Supabase Realtime and stacks a small card in the
 * bottom-left corner for each new lead. Cards auto-dismiss after 8s or on X.
 * Rendered once (from the Sidebar) so it runs on every authenticated page.
 */
export function LeadToaster() {
  const [toasts, setToasts] = useState<LeadToast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

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

      channel = supabase
        .channel('leads-toaster')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'leads', filter: `tenant_id=eq.${tenant.id}` },
          (payload) => {
            const lead = payload.new as { id?: string; name?: string | null; phone?: string | null; source?: string | null }
            const id = lead.id || `${Date.now()}-${Math.random()}`
            setToasts((prev) => [...prev, { id, name: lead.name ?? null, phone: lead.phone ?? null, source: lead.source ?? null }])
            setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
          },
        )
        .subscribe()
    })()

    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [dismiss])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
      {toasts.map((lead) => (
        <div
          key={lead.id}
          className="bg-white rounded-xl shadow-2xl border border-gray-100 p-4 w-80 flex items-start gap-3 animate-slide-up"
        >
          <div className="w-10 h-10 bg-teal-500 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-white text-lg">📞</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm">New lead from AI call</p>
            <p className="text-gray-600 text-xs mt-0.5 truncate">
              {lead.name || 'Unknown'} • {lead.phone || 'No number'}
            </p>
            <p className="text-gray-400 text-xs mt-0.5">Just now</p>
          </div>
          <button
            onClick={() => dismiss(lead.id)}
            aria-label="Dismiss"
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
