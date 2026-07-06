import Link from 'next/link'
import { Lock } from 'lucide-react'

/**
 * Shown inside the app shell when a user opens a route whose module is not enabled for their
 * business (direct-URL access to a disabled module). Server-safe — no client hooks.
 */
export function ModuleDisabled({ name }: { name: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="mx-auto w-full max-w-sm rounded-2xl border border-hairline-strong bg-white p-8 text-center shadow-e1">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sunken text-muted">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className="text-lg font-semibold text-ink">{name} isn’t enabled</h1>
        <p className="mt-2 text-sm text-muted">
          This module isn’t part of your workspace. Contact your administrator to turn it on.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-white transition-colors hover:bg-ink/90"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}
