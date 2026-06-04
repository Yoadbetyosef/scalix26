import { Sidebar } from '@/components/dashboard/sidebar'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function TestAILayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <div className="flex h-full min-h-screen bg-[#f8f9fa]">
      <Sidebar />
      <main className="flex-1 md:ml-16 xl:ml-56 flex flex-col pb-[72px] md:pb-0" style={{ height: '100vh' }}>
        {children}
      </main>
    </div>
  )
}
