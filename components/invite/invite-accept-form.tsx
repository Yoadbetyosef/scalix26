'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

// The invited owner sets a password → we create+link their account server-side → then we establish a
// session with the SAME password and drop them into their own (branded) business. No Scalix, no portal.
export function InviteAcceptForm({ token, email, ctaColor }: { token: string; email: string; ctaColor: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const supabase = createClient()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) return toast.error('Use at least 8 characters.')
    if (password !== confirm) return toast.error('Passwords don’t match.')
    setBusy(true)
    try {
      const r = await fetch('/api/invite/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setBusy(false); return toast.error(j.error || 'Could not create your account.') }
      // Establish the session with the credentials we just set, then enter the business.
      const { error } = await supabase.auth.signInWithPassword({ email: j.email, password })
      if (error) { setBusy(false); return toast.error('Account created — please sign in.') }
      window.location.href = '/dashboard'
    } catch {
      setBusy(false); toast.error('Something went wrong — please try again.')
    }
  }

  const inp = 'h-12 w-full rounded-xl border border-hairline bg-white px-4 text-[15px] text-ink outline-none transition-shadow focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.05)]'
  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Your email</label>
        <input value={email} disabled className={`${inp} bg-sunken text-subtle`} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Create a password</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inp} />
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink">Confirm password</label>
        <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className={inp} />
      </div>
      <button type="submit" disabled={busy}
        className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white shadow-sm transition-all hover:brightness-105 disabled:opacity-60"
        style={{ background: ctaColor }}>
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Create account & sign in <ArrowRight className="h-4 w-4" /></>}
      </button>
    </form>
  )
}
