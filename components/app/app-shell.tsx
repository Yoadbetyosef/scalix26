import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sidebar } from '@/components/dashboard/sidebar'

/**
 * The Scalix authenticated shell — the continuation of the /auth world inside the app.
 * A near-white canvas with a barely-visible purple/pink ambient wash, the calm sidebar,
 * and the page content. Presentation only: each route's layout keeps its own auth check
 * and simply wraps its children in this shell.
 */
export function AppShell({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) {
  return (
    <div className="relative flex min-h-screen bg-white">
      {/* Ambient atmosphere — fixed, barely there, behind everything */}
      <div
        aria-hidden="true"
        className="sx-drift-1 pointer-events-none fixed -left-40 -top-40 h-[520px] w-[520px] rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, #8e9bf0 8%, transparent), transparent 70%)' } as CSSProperties}
      />
      <div
        aria-hidden="true"
        className="sx-drift-2 pointer-events-none fixed -bottom-48 -right-40 h-[560px] w-[560px] rounded-full"
        style={{ background: 'radial-gradient(circle, color-mix(in oklab, #f0a9d6 7%, transparent), transparent 70%)' } as CSSProperties}
      />

      <Sidebar />

      <main className={cn('relative flex-1 pb-[72px] md:ml-16 md:pb-0 xl:ml-56', mainClassName)}>
        {children}
      </main>
    </div>
  )
}
