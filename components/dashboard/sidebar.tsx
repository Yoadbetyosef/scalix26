'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
  Users,
  Bot,
  BarChart3,
  FileText,
  Settings,
  LogOut,
  Zap,
  FlaskConical,
  MoreHorizontal,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const navItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/contacts', icon: Users, label: 'Contacts' },
  { href: '/ai-employees', icon: Bot, label: 'AI Employees' },
  { href: '/test-ai', icon: FlaskConical, label: 'Test AI' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/reports', icon: FileText, label: 'Reports' },
  { href: '/settings', icon: Settings, label: 'Settings' },
]

// First 4 items in bottom bar, rest in "More" drawer
const bottomPrimary = navItems.slice(0, 4)
const bottomMore = navItems.slice(4)

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [businessName, setBusinessName] = useState<string>('')
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    async function loadBusinessName() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: tenant } = await supabase
        .from('tenants')
        .select('business_name')
        .eq('user_id', user.id)
        .single()
      if (tenant?.business_name) setBusinessName(tenant.business_name)
    }
    loadBusinessName()
  }, [])

  // Close drawer on route change
  useEffect(() => { setMoreOpen(false) }, [pathname])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const moreActive = bottomMore.some(item => pathname.startsWith(item.href))

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-16 xl:w-56 bg-[#1a1f36] min-h-screen fixed left-0 top-0 bottom-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/10">
          <div className="flex-shrink-0 w-8 h-8 bg-[#4ecdc4] rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">
              {businessName ? businessName.charAt(0).toUpperCase() : <Zap className="w-4 h-4" />}
            </span>
          </div>
          <span className="hidden xl:block text-white font-bold text-base tracking-tight leading-tight">
            {businessName || 'Dashboard'}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  active
                    ? 'bg-[#252b4a] text-white'
                    : 'text-gray-400 hover:bg-[#252b4a] hover:text-white'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                <span className="hidden xl:block">{label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Sign out */}
        <div className="px-2 py-4 border-t border-white/10">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:bg-[#252b4a] hover:text-white transition-colors w-full"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="hidden xl:block">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#1a1f36] border-t border-white/10 z-40 flex safe-area-inset-bottom">
        {bottomPrimary.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium transition-colors min-h-[56px] justify-center',
                active ? 'text-[#4ecdc4]' : 'text-gray-400'
              )}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span>{label}</span>
            </Link>
          )
        })}
        {/* More button */}
        <button
          onClick={() => setMoreOpen(true)}
          className={cn(
            'flex-1 flex flex-col items-center py-2 pt-3 text-[10px] font-medium transition-colors min-h-[56px] justify-center',
            moreActive ? 'text-[#4ecdc4]' : 'text-gray-400'
          )}
        >
          <MoreHorizontal className="w-5 h-5 mb-1" />
          <span>More</span>
        </button>
      </nav>

      {/* Mobile More Drawer */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMoreOpen(false)}
          />
          {/* Drawer */}
          <div className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="font-semibold text-gray-900">
                {businessName || 'Menu'}
              </span>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="px-4 py-3">
              {bottomMore.map(({ href, icon: Icon, label }) => {
                const active = pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium transition-colors',
                      active
                        ? 'bg-[#4ecdc4]/10 text-[#4ecdc4]'
                        : 'text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <Icon className="w-5 h-5 flex-shrink-0" />
                    {label}
                  </Link>
                )
              })}
            </nav>
            <div className="px-4 pb-6 border-t border-gray-100 pt-3">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-3 py-3.5 rounded-xl text-base font-medium text-red-500 hover:bg-red-50 transition-colors w-full"
              >
                <LogOut className="w-5 h-5 flex-shrink-0" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
