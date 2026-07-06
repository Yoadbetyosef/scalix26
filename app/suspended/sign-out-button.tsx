'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function SignOutButton() {
  const router = useRouter()
  async function signOut() {
    try { await createClient().auth.signOut() } catch { /* noop */ }
    router.push('/auth/login')
  }
  return (
    <button onClick={signOut} className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-white hover:bg-ink/90">
      Sign out
    </button>
  )
}
