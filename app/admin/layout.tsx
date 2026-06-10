import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/admin/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin()
  if (!admin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-gray-900 text-white px-6 py-3 flex items-center gap-6">
        <span className="font-bold text-lg">Scalix Admin</span>
        <a href="/admin" className="text-gray-300 hover:text-white text-sm">Dashboard</a>
        <a href="/dashboard" className="ml-auto text-gray-400 hover:text-white text-sm">← Back to app</a>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  )
}
