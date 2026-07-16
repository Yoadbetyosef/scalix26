import { notFound } from 'next/navigation'
import { AppShell } from '@/components/app/app-shell'
import { getTenantEnabledModules } from '@/lib/tenant'
import { CommerceNav } from '@/components/commerce/commerce-nav'

export const dynamic = 'force-dynamic'

// Server-enforced module gate: a tenant without `commerce` gets a 404 for the entire section
// (never just hidden in the UI). Wraps the section in the standard app shell + sub-navigation.
export default async function CommerceLayout({ children }: { children: React.ReactNode }) {
  const modules = await getTenantEnabledModules()
  if (!modules.includes('commerce')) notFound()
  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <CommerceNav />
      </div>
      {children}
    </AppShell>
  )
}
