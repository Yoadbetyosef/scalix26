import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sidebar } from '@/components/dashboard/sidebar'
import { OperatorBar } from '@/components/app/operator-bar'
import { getActiveWorkspace } from '@/lib/workspace'
import { getTenantEnabledModules } from '@/lib/tenant'

/**
 * The Scalix authenticated shell — the continuation of the /auth world inside the app.
 * A near-white canvas with a barely-visible purple/pink ambient wash, the calm sidebar,
 * and the page content. Presentation only: each route's layout keeps its own auth check
 * and simply wraps its children in this shell. When a White Label partner is operating a
 * client workspace, an OperatorBar is shown on top (Back to Company).
 */
export async function AppShell({ children, mainClassName }: { children: ReactNode; mainClassName?: string }) {
  const ws = await getActiveWorkspace()
  const operator = ws.mode === 'operator'
  // Hide partner/admin/Scalix-billing surfaces for the whole White Label plane: both when a partner is
  // OPERATING a client, AND when the logged-in CUSTOMER's own business is a White Label client. A WL
  // customer must never see "Partner Program", Admin, or Scalix billing — it's the partner's product.
  const whiteLabel = operator || !!ws.whiteLabelPartnerId
  // In operator mode the sidebar can't resolve the client via user_id, so pass the server-validated
  // client business name + the client tenant's effective modules (getTenantEnabledModules is
  // active-workspace aware). Owner mode passes nothing → the sidebar keeps its own client-side load.
  const operatorModules = operator ? await getTenantEnabledModules() : undefined
  return (
    <>
      {/* print:hidden throughout — printable pages (estimates, quotes, order documents) must come out as
          the document alone, with no app chrome around it. */}
      {operator && <div className="print:hidden"><OperatorBar businessName={ws.businessName ?? null} /></div>}
      <div className="relative flex min-h-screen bg-white">
        {/* Ambient atmosphere — barely there, behind everything. Wrapped in a fixed, viewport-sized,
            non-interactive layer that CLIPS the blobs on mobile so their off-screen overflow can
            never create horizontal document scroll. On desktop (sm+) the layer lets them overflow
            exactly as before, so the desktop look is unchanged. */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden sm:overflow-visible print:hidden">
          <div
            className="sx-drift-1 absolute -left-40 -top-40 h-[360px] w-[360px] rounded-full sm:h-[520px] sm:w-[520px]"
            style={{ background: 'radial-gradient(circle, color-mix(in oklab, #8e9bf0 8%, transparent), transparent 70%)' } as CSSProperties}
          />
          <div
            className="sx-drift-2 absolute -bottom-48 -right-40 h-[360px] w-[360px] rounded-full sm:h-[560px] sm:w-[560px]"
            style={{ background: 'radial-gradient(circle, color-mix(in oklab, #f0a9d6 7%, transparent), transparent 70%)' } as CSSProperties}
          />
        </div>

        <div className="print:hidden">
          <Sidebar operator={operator} whiteLabel={whiteLabel} operatorBusinessName={ws.businessName ?? null} operatorModules={operatorModules} />
        </div>

        {/* min-w-0: a flex child defaults to min-width:auto and would expand to its content's
            min-content width (wider than the phone). This lets <main> shrink to the viewport so
            nothing gets pushed past the screen edge. */}
        <main className={cn('relative min-w-0 flex-1 pb-[72px] md:ml-16 md:pb-0 xl:ml-56 print:ml-0 print:pb-0', mainClassName)}>
          {children}
        </main>
      </div>
    </>
  )
}
