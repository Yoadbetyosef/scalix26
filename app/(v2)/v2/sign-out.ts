'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Sign out, exactly as app/suspended/sign-out-button.tsx does it: clear the Supabase session, swallow
// a failure, and go to the login page. Reused rather than reinvented — a second sign-out that drifts
// from the first is a session that looks ended and is not.
//
// It lives here, above both navigation surfaces, because the rail and the sheet each render the row
// and neither should own the behaviour.
export function useSignOut() {
  const router = useRouter()
  return async function signOut() {
    try { await createClient().auth.signOut() } catch { /* noop */ }
    router.push('/auth/login')
  }
}
