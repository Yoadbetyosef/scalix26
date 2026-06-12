'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// TEMPORARY — manual test for the realtime new-lead toast. Inserts a lead via
// the browser Supabase client (source 'voice_call', so it also verifies the
// CHECK-constraint fix). Remove this once notifications are confirmed working.
export function DevTestLeadButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function insertTestLead() {
    setBusy(true)
    setMsg('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setMsg('not signed in'); setBusy(false); return }
    const { data: tenant } = await supabase.from('tenants').select('id').eq('user_id', user.id).single()
    if (!tenant) { setMsg('no tenant'); setBusy(false); return }

    const { data, error } = await supabase
      .from('leads')
      .insert({ tenant_id: tenant.id, phone: '+15555550123', name: 'Test Lead', source: 'voice_call', status: 'new' })
      .select()
      .single()

    if (error) {
      console.error('[dev-test-lead] insert error:', error)
      setMsg('❌ ' + error.message + (error.code === '23514' ? ' (run the voice_call constraint migration)' : ''))
    } else {
      console.log('[dev-test-lead] inserted:', data)
      setMsg('✅ inserted — toast should pop bottom-left')
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={insertTestLead}
        disabled={busy}
        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200 disabled:opacity-50"
      >
        {busy ? 'inserting…' : '🧪 Test lead toast'}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  )
}
