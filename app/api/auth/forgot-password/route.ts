import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email/send'
import { enforce, clientIp } from '@/lib/ratelimit'

// PUBLIC self-serve password reset. Sends the reset link through OUR verified Resend domain (like every
// other app email) instead of Supabase's unreliable built-in email. Uses admin.generateLink (type:
// recovery) — a token-hash link that works cross-device (no PKCE verifier needed) and lands on
// /auth/update-password with a live recovery session. Always returns ok so it never reveals whether an
// account exists. Rate-limited by IP to prevent email-bombing.
function resetEmailHtml(link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:520px;margin:0 auto;padding:24px">
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
      <div style="font-size:14px;font-weight:600;color:#374151">Scalix</div>
      <h1 style="font-size:20px;margin:12px 0 6px">Reset your password</h1>
      <p style="font-size:14px;color:#4b5563;margin:0 0 16px">We received a request to reset your Scalix password. Click the button below to choose a new one. This link expires in 1 hour.</p>
      <a href="${link}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px">Reset password</a>
      <p style="font-size:12px;color:#9ca3af;margin:18px 0 0">If you didn't request this, you can safely ignore this email — your password won't change.</p>
    </div>
  </div></body></html>`
}

export async function POST(req: NextRequest) {
  const flood = await enforce('password_reset', `ip:${clientIp(req)}`)
  if (flood) return flood

  const body = (await req.json().catch(() => ({}))) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''

  if (email && email.includes('@')) {
    try {
      const baseUrl = req.nextUrl.origin || process.env.NEXT_PUBLIC_APP_URL || ''
      const admin = createAdminClient()
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${baseUrl}/auth/update-password` },
      })
      const link = data?.properties?.action_link
      // error (e.g. "User not found") is intentionally swallowed — never reveal account existence.
      if (!error && link) {
        await sendEmail(email, 'Reset your Scalix password', resetEmailHtml(link))
      }
    } catch { /* never reveal — always return ok below */ }
  }

  return NextResponse.json({ ok: true })
}
