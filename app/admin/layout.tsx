import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin()
  if (!admin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-sunken">
      <nav className="bg-gray-900 text-white px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className="font-bold text-lg">Scalix Admin</span>
        <a href="/admin" className="tap-target inline-block py-3 -my-3 text-muted hover:text-white text-sm">Dashboard</a>
        <a href="/admin/modules" className="tap-target inline-block py-3 -my-3 text-muted hover:text-white text-sm">Modules</a>
        <a href="/dashboard" className="tap-target inline-block py-3 -my-3 ml-auto text-muted hover:text-white text-sm">← Back to app</a>
      </nav>
      <main className="p-4 sm:p-6">{children}</main>
    </div>
  )
}
