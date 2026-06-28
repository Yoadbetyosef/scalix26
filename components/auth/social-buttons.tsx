'use client'

import { toast } from 'sonner'

function GoogleIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.02-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg className="h-[16px] w-[16px]" viewBox="0 0 16 16" aria-hidden="true">
      <rect width="7" height="7" x="0" y="0" fill="#F25022" />
      <rect width="7" height="7" x="9" y="0" fill="#7FBA00" />
      <rect width="7" height="7" x="0" y="9" fill="#00A4EF" />
      <rect width="7" height="7" x="9" y="9" fill="#FFB900" />
    </svg>
  )
}

const buttonClass =
  'flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-hairline bg-white text-[15px] font-medium text-ink transition-colors hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/10'

/**
 * Social sign-in buttons — designed to match the SCALIX26 DNA. Real Google/Microsoft
 * OAuth is a deferred sprint (the app is email/password today), so these surface a
 * clear "coming soon" rather than a broken flow.
 */
export function SocialButtons() {
  const soon = (provider: string) => toast.info(`${provider} sign-in is coming soon.`)

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => soon('Google')} className={buttonClass}>
        <GoogleIcon />
        Continue with Google
      </button>
      <button type="button" onClick={() => soon('Microsoft')} className={buttonClass}>
        <MicrosoftIcon />
        Continue with Microsoft
      </button>
    </div>
  )
}
