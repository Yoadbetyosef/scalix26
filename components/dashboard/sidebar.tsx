'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
  Package,
  Bot,
  BarChart3,
  FileText,
  Settings,
  CreditCard,
  LogOut,
  FlaskConical,
  Handshake,
  Shield,
  ClipboardList,
  Ship,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NotificationCenter } from '@/components/dashboard/notification-center'
import { type BrandConfig, DEFAULT_BRAND, detectBrand } from '@/lib/brands'
import { useBrand } from '@/components/brand/brand-provider'
import { ALL_MODULES, enabledModulesOf, effectiveModules, moduleForNav, type ModuleKey, type ModuleState } from '@/lib/modules'
import { GROUP_HUE } from '@/app/(v2)/v2/nav-icons'
import { MobileSheet } from '@/components/dashboard/mobile-sheet'
import { ChevronRight } from 'lucide-react'
import { Calendar, BookLock } from 'lucide-react'
import '@/app/(v2)/v2/v2-tokens.css'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/appointments', icon: Calendar, label: 'Appointments' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/orders', icon: ClipboardList, label: 'Orders' },
  { href: '/catalog', icon: Package, label: 'Catalog' },
  // Beside Catalog, because that is what it fills. The page has existed since landed cost shipped and
  // was reachable only by typing the URL — so the tenant it was built for could upload a supplier
  // invoice, and had no way to find the screen that does it. moduleForNav resolves /landed-cost to
  // `landed_cost`, so this line is invisible to every business without the module and needs no gate
  // of its own. Deliberately absent from OPERATOR_SAFE_LABELS below: a supplier invoice IS the
  // business's cost structure line by line, and lib/invoices/store.ts already refuses an operator.
  { href: '/landed-cost', icon: Ship, label: 'Supplier bills' },
  { href: '/ai-employees', icon: Bot, label: 'AI Employees' },
  { href: '/test-ai', icon: FlaskConical, label: 'Test AI' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/reports', icon: FileText, label: 'Reports' },
  { href: '/settings#billing', icon: CreditCard, label: 'Billing & Subscription' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

// ── THE THREE SECTIONS, /v2's ────────────────────────────────────────────────────────────────────
//
// Labels only. Every href, icon and module gate stays in navItems above, untouched — this says which
// section a label belongs to and nothing else, so a route cannot acquire a different destination by
// being regrouped.
//
// TWO LABELS HAVE NO v1 ROUTE and are rendered inert, exactly as /v2 renders them:
//   Appointments — /v2/appointments exists, v1 has none. Its nearest relative, /settings/availability,
//                  configures when you are free rather than showing what is booked. Not the same page.
//   Knowledge    — has no route of its own on either side; /v2's nav.ts says so in as many words. It
//                  is a section of an AI employee's detail screen, reached through that employee.
// A row that goes nowhere is honest. A row pointed at an approximate page is not.
const SECTIONS: { id: string; label: string; items: string[] }[] = [
  { id: 'g1', label: 'Rudi', items: ['Inbox', 'Appointments', 'Contacts', 'AI Employees', 'Knowledge', 'Test AI'] },
  { id: 'g2', label: 'Business', items: ['Orders', 'Catalog', 'Supplier bills', 'Analytics', 'Reports'] },
  { id: 'g3', label: 'Account', items: ['Billing & Subscription', 'Settings'] },
]
// Dashboard is in none of the three, because it is not a destination among destinations — it is the
// screen the rail sits beside. It stays above them, where /v2 puts its primaries.
const PRIMARY_LABEL = 'Dashboard'

/** Marks for the two rows that have no page. Same icons /v2 gives them. */
// Knowledge alone now. Appointments came off this list the day it got a page: it was inert because
// the schedule lived in a tab under the dashboard hero and there was nowhere honest to point at.
const INERT = new Map<string, typeof Calendar>([['Knowledge', BookLock]])

// First 4 (visible) items go in the mobile bottom bar, the rest in the "More" drawer.
// The split happens per-render after module filtering (see visibleNav below).

// Routes verified operator-safe (reads AND mutations scoped to the active client tenant). These appear
// in a White Label operator's client workspace — the FULL product minus Scalix billing. "Billing &
// Subscription" is intentionally excluded (a client's plan is governed by the partner, never Scalix).
const OPERATOR_SAFE_LABELS = new Set<string>(['Dashboard', 'Inbox', 'Contacts', 'Catalog', 'AI Employees', 'Test AI', 'Analytics', 'Reports', 'Settings'])

export function Sidebar({ operator = false, whiteLabel = false, operatorBusinessName = null, operatorModules }: {
  operator?: boolean
  // True across the whole White Label plane (partner operating a client OR a WL customer's own login):
  // hides Partner Program, Admin, and Scalix billing. `operator` additionally drives tenant resolution.
  whiteLabel?: boolean
  operatorBusinessName?: string | null
  operatorModules?: ModuleKey[]
} = {}) {
  const hidePartnerSurfaces = operator || whiteLabel
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  // RUDI open, the others closed — /v2 opens its first group and leaves the rest shut.
  const [open, setOpen] = useState<Record<string, boolean>>({ g1: true })
  // Whether an employee is actually on duty. /v2 shows an ON badge beside AI Employees and derives
  // it as `some(e => e.is_active !== false)`; same test here, so the two surfaces cannot disagree
  // about whether anybody is answering.
  const [aiOn, setAiOn] = useState(false)
  const [businessName, setBusinessName] = useState<string>('')
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const pb = useBrand() // DB-driven partner brand (resolved by domain)
  const [plan, setPlan] = useState<string | null>(null)
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  // Default to ALL so nothing flickers/hides before the tenant's modules load.
  const [enabledModules, setEnabledModules] = useState<ModuleKey[]>(ALL_MODULES)

  const itemActive = (href: string, label: string) => {
    if (label === 'Dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  useEffect(() => {
    // Operator mode: the client can't be resolved via user_id (that's the PARTNER's tenant). Use the
    // server-validated client name + client modules passed as props, and never load the partner's
    // plan/trial (no Scalix billing inside a client workspace).
    if (operator) {
      setBusinessName(operatorBusinessName || '')
      if (operatorModules) setEnabledModules(operatorModules)
      return
    }
    async function loadBusinessName() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const [{ data: tenant }, { data: flagRows }] = await Promise.all([
        supabase.from('tenants').select('id, business_name, plan, trial_ends_at, enabled_modules, tags').eq('user_id', user.id).single(),
        supabase.from('module_flags').select('module, state'),
      ])
      if (tenant?.business_name) setBusinessName(tenant.business_name)
      setPlan(tenant?.plan ?? null)
      setTrialEndsAt(tenant?.trial_ends_at ?? null)
      // Effective modules = the business's own set filtered by the global feature-flag state.
      const flags = Object.fromEntries((flagRows || []).map((f) => [f.module, f.state as ModuleState]))
      const isEnterprise = Array.isArray(tenant?.tags) && tenant.tags.includes('Enterprise')
      setEnabledModules(effectiveModules(enabledModulesOf(tenant), flags, isEnterprise))
      if (tenant?.id) {
        const { data: emps } = await supabase.from('ai_employees').select('is_active').eq('tenant_id', tenant.id)
        setAiOn(!!emps?.some((e) => (e as { is_active?: boolean }).is_active !== false))
      }
    }
    loadBusinessName()
  }, [operator, operatorBusinessName, operatorModules])

  // Resolve the host-based brand (myLocksmith / Scalix26 / default) once on mount.
  useEffect(() => { setBrand(detectBrand()) }, [])

  // Admin-only: show the Admin link if this user resolves to a platform admin (server-verified).
  // NEVER inside a client workspace — admin/partner surfaces must not leak into operator mode.
  useEffect(() => {
    if (hidePartnerSurfaces) { setIsAdmin(false); return }
    fetch('/api/me/admin').then((r) => r.json()).then((j) => setIsAdmin(!!j.isAdmin)).catch(() => {})
  }, [hidePartnerSurfaces])

  async function handleSignOut() {
    // Clear any active operator workspace cookie before signing out (best-effort; the httpOnly
    // cookie can only be cleared server-side, and middleware also clears it when there's no user).
    if (operator) await fetch('/api/partner/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'exit' }) }).catch(() => {})
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Hide nav items whose module is disabled for this business. Items with no module
  // (Dashboard, Analytics, Reports, Billing, Settings) always show. Filtering before the
  // primary/more split keeps up to 4 items in the mobile bottom bar.
  const visibleNav = navItems.filter((i) => {
    // The whole White Label plane (partner operating a client, OR a WL customer's own login) never sees
    // Scalix billing — a client's plan is governed by the partner. All product routes are operator-safe.
    if (hidePartnerSurfaces && i.label === 'Billing & Subscription') return false
    // Belt-and-suspenders: in impersonation mode keep the verified operator-safe allowlist.
    if (operator && !OPERATOR_SAFE_LABELS.has(i.label)) return false
    const m = moduleForNav(i.href)
    return !m || enabledModules.includes(m)
  })
  // The same four states TrialWidget computes, read the same way from the same two fields.
  const planRow = (() => {
    const isTrial = !plan || plan === 'trial'
    if (!isTrial) return { label: `${(plan ?? '').charAt(0).toUpperCase()}${(plan ?? '').slice(1)} plan`, badge: '', urgent: false }
    const daysLeft = trialEndsAt ? Math.max(0, Math.floor((new Date(trialEndsAt).getTime() - Date.now()) / 86400000)) : null
    if (daysLeft !== null && daysLeft <= 0) return { label: 'Trial ended', badge: 'UPGRADE', urgent: true }
    if (daysLeft === null) return { label: 'Free trial', badge: '', urgent: false }
    return { label: `Trial · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`, badge: daysLeft <= 3 ? String(daysLeft) : '', urgent: daysLeft <= 3 }
  })()

  return (
    <>
      {/* THE RAIL, /v2's. Same markup, same classes, same collapsing sections — v1's routes.
          `.v2` carries the tokens every rule below reads; the rules themselves are scoped to it, so
          nothing here can reach the page beside it. */}
      <aside className="v2 hidden md:flex w-16 xl:w-[236px] h-screen fixed left-0 top-0 bottom-0 z-40">
        <div className="v2-rail" data-scroll style={{ width: '100%' }}>
          {/* YOUR BUSINESS, and the employee under it. The logo moved out: /v2 leads with whose
              business this is, not with whose software it is. Partner brands keep their mark beside it. */}
          <div className="v2-co">
            {pb?.isPartnerBrand && pb.logoUrl
              ? <img src={pb.logoUrl} alt={pb.name} className="mb-2 h-5 w-auto max-w-[120px] object-contain" />
              : null}
            <b className="hidden xl:block">{businessName || pb?.name || brand.name}</b>
            <span className="hidden xl:flex"><i />Rudi · on duty</span>
          </div>

          {/* The home row, above the sections. */}
          <div className="v2-stagger" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
            {visibleNav.filter((i) => i.label === PRIMARY_LABEL).map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="v2-nav v2-grow" data-touch data-on={itemActive(href, label) || undefined}>
                <span className="v2-gchip"><Icon /></span>
                <span className="v2-glab hidden xl:block">{label}</span>
              </Link>
            ))}
          </div>

          {SECTIONS.map((g) => {
            const items = g.items
              .map((label) => visibleNav.find((i) => i.label === label) ?? (INERT.has(label) ? { href: '', icon: INERT.get(label)!, label } : null))
              .filter(Boolean) as { href: string; icon: typeof Handshake; label: string }[]
            if (!items.length) return null
            return (
              <div key={g.id} style={{ ['--ghue' as string]: GROUP_HUE[g.id] }}>
                <button
                  type="button"
                  className="v2-gh"
                  data-open={open[g.id] || undefined}
                  onClick={() => setOpen((p) => ({ ...p, [g.id]: !p[g.id] }))}
                  aria-expanded={!!open[g.id]}
                >
                  <i className="v2-gdot" />
                  <span className="hidden xl:block">{g.label}</span>
                  <s className="v2-grule" />
                  <svg viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
                </button>
                <div className="v2-sub" data-open={open[g.id] || undefined}>
                  {items.map(({ href, icon: Icon, label }) => {
                    const inner = (
                      <>
                        <span className="v2-gchip"><Icon /></span>
                        <span className="v2-glab hidden xl:block">{label}</span>
                        {/* Only where /v2 puts it, and only when somebody is actually on duty — a badge
                            that is always lit says nothing. */}
                        {label === 'AI Employees' && aiOn && <em data-live>ON</em>}
                      </>
                    )
                    const attrs = { className: 'v2-nav v2-grow', 'data-touch': true, 'data-on': (href && itemActive(href, label)) || undefined }
                    // No href means no page — inert, the way /v2 renders the same two rows.
                    return href
                      ? <Link key={label} href={href} {...attrs}>{inner}</Link>
                      : <button key={label} type="button" {...attrs} disabled>{inner}</button>
                  })}
                </div>
              </div>
            )
          })}

          {/* THE PLAN, AS A ROW. It was TrialWidget — a red panel with a red "Upgrade now" button
              wedged between the sections, which is the one thing on this rail that shouts. Same four
              states TrialWidget derives (paid, trial, trial low, expired), same href, same gating,
              same words. What is gone is the block: urgency is an <em> badge on a row, which is how
              this rail says everything else that needs saying. */}
          {!hidePartnerSurfaces && plan && (
            <div style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
              <Link href="/settings#billing" className="v2-nav v2-grow" data-touch>
                <span className="v2-gchip"><CreditCard /></span>
                <span className="v2-glab hidden xl:block">{planRow.label}</span>
                {planRow.badge && <em data-live={planRow.urgent || undefined}>{planRow.badge}</em>}
              </Link>
            </div>
          )}

          {!hidePartnerSurfaces && (
            <div style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
              <Link href="/partner" className="v2-nav v2-grow" data-touch>
                <span className="v2-gchip"><Handshake /></span>
                <span className="v2-glab hidden xl:block">Partner Program</span>
              </Link>
              {isAdmin && (
                <Link href="/admin" className="v2-nav v2-grow" data-touch>
                  <span className="v2-gchip"><Shield /></span>
                  <span className="v2-glab hidden xl:block">Admin</span>
                </Link>
              )}
            </div>
          )}

          <div className="mt-auto" style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
            <button type="button" onClick={handleSignOut} className="v2-nav v2-grow" data-touch>
              <span className="v2-gchip"><LogOut /></span>
              <span className="v2-glab hidden xl:block">Sign Out</span>
            </button>
            {pb?.isPartnerBrand && pb.poweredByScalix && <div className="hidden xl:block px-3 pt-2 text-[10px] text-muted">Powered by Scalix</div>}
          </div>
        </div>
      </aside>

      {/* ── THE PHONE'S NAVIGATION ──────────────────────────────────────────────────────────────
          Was a five-slot tab bar plus a "More" drawer: two surfaces, two languages, and the split
          at four decided by which modules a business had enabled — so no two tenants navigated the
          same way. This is /v2's sheet, carrying the SAME three sections as the rail beside it, in
          the same order, off the same `visibleNav` and the same gating. Nothing is promoted to a
          tab and nothing is hidden behind a second door.

          Every row here is built from the same arrays the rail above uses. If a module is disabled,
          or an operator is in a client workspace, the row is missing from BOTH — there is no second
          list to keep in step. */}
      <MobileSheet label="Menu">
        {(close) => (
          <>
            <div className="v2-nco">
              <b>{businessName || pb?.name || brand.name}</b>
              <span><i />Rudi · on duty</span>
            </div>

            {/* The home row, above the sections — exactly where the rail puts it. */}
            <div className="v2-group" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
              <div className="v2-gcard">
                {visibleNav.filter((i) => i.label === PRIMARY_LABEL).map(({ href, icon: Icon, label }) => (
                  <Link key={href} href={href} className="v2-grow" data-touch onClick={close}
                        data-on={itemActive(href, label) || undefined}>
                    <span className="v2-gchip"><Icon /></span>
                    <span className="v2-glab">{label}</span>
                    <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>
                  </Link>
                ))}
              </div>
            </div>

            {SECTIONS.map((g) => {
              const items = g.items
                .map((label) => visibleNav.find((i) => i.label === label) ?? (INERT.has(label) ? { href: '', icon: INERT.get(label)!, label } : null))
                .filter(Boolean) as { href: string; icon: typeof Handshake; label: string }[]
              if (!items.length) return null
              return (
                <div key={g.id} className="v2-group" style={{ ['--ghue' as string]: GROUP_HUE[g.id] }}>
                  <p className="v2-ghead"><i />{g.label}<s /></p>
                  <div className="v2-gcard">
                    {items.map(({ href, icon: Icon, label }) => {
                      const inner = (
                        <>
                          <span className="v2-gchip"><Icon /></span>
                          <span className="v2-glab">{label}</span>
                          {label === 'AI Employees' && aiOn && <em data-live>ON</em>}
                          {href && <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>}
                        </>
                      )
                      const attrs = { className: 'v2-grow', 'data-touch': true, 'data-on': (href && itemActive(href, label)) || undefined }
                      // No href means no page — inert here for the same reason it is inert on the rail.
                      return href
                        ? <Link key={label} href={href} {...attrs} onClick={close}>{inner}</Link>
                        : <button key={label} type="button" {...attrs} disabled>{inner}</button>
                    })}
                  </div>
                </div>
              )
            })}

            {/* THE PLAN, AS A ROW — the rail's fourth state included. Same four states, same href,
                same gating, same words; the urgency is the badge, not a red block. */}
            {!hidePartnerSurfaces && plan && (
              <div className="v2-group" style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
                <div className="v2-gcard">
                  <Link href="/settings#billing" className="v2-grow" data-touch onClick={close}>
                    <span className="v2-gchip"><CreditCard /></span>
                    <span className="v2-glab">{planRow.label}</span>
                    {planRow.badge && <em data-live={planRow.urgent || undefined}>{planRow.badge}</em>}
                    <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>
                  </Link>
                </div>
              </div>
            )}

            <div className="v2-group" style={{ ['--ghue' as string]: GROUP_HUE.g3 }}>
              <div className="v2-gcard">
                {!hidePartnerSurfaces && (
                  <Link href="/partner" className="v2-grow" data-touch onClick={close}>
                    <span className="v2-gchip"><Handshake /></span>
                    <span className="v2-glab">Partner Program</span>
                    <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>
                  </Link>
                )}
                {!hidePartnerSurfaces && isAdmin && (
                  <Link href="/admin" className="v2-grow" data-touch onClick={close}>
                    <span className="v2-gchip"><Shield /></span>
                    <span className="v2-glab">Admin</span>
                    <span className="v2-gtrail"><ChevronRight className="v2-gchev" /></span>
                  </Link>
                )}
                <button type="button" onClick={handleSignOut} className="v2-grow" data-touch>
                  <span className="v2-gchip"><LogOut /></span>
                  <span className="v2-glab">Sign Out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </MobileSheet>

      {/* Persistent notification center — bell, bottom-right */}
      <NotificationCenter />
    </>
  )
}
