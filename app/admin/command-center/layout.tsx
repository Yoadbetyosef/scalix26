import { notFound } from 'next/navigation'
import { getFounderContext } from '@/lib/command-center/guard'
import { Subnav } from '@/components/command-center/subnav'

// Founder-confidential. BOTH the CEO_COMMAND_CENTER_ENABLED flag AND the founder allow-list are required;
// anyone else (anonymous, a non-founder admin, or a founder with the flag off) gets a 404 — the route's
// existence is never revealed. This runs in addition to the /admin layout's admin gate.
export default async function CommandCenterLayout({ children }: { children: React.ReactNode }) {
  const founder = await getFounderContext()
  if (!founder) notFound()

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">CEO Command Center</h1>
        <p className="text-sm text-subtle">Mission control for Scalix26 — founder-confidential.</p>
      </div>
      <Subnav />
      {children}
    </div>
  )
}
