import { Lock } from 'lucide-react'
import { SignOutButton } from './sign-out-button'

export default function SuspendedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-sunken p-6">
      <div className="w-full max-w-sm rounded-2xl border border-hairline-strong bg-white p-8 text-center shadow-e1">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <Lock className="h-5 w-5" />
        </span>
        <h1 className="text-lg font-semibold text-ink">Account suspended</h1>
        <p className="mt-2 text-sm text-muted">
          Your account has been suspended. Please contact support to restore access.
        </p>
        <SignOutButton />
      </div>
    </div>
  )
}
