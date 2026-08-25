import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { MetaPagePickerClient } from '@/components/ai-employees/meta-page-picker-client'

interface MetaPageData {
  id: string
  name: string
  access_token: string
  instagram: { id: string; name: string; username: string } | null
}

export default async function ConnectMetaPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: agentId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const cookieStore = await cookies()
  const raw = cookieStore.get('meta_pending_pages')?.value

  if (!raw) {
    // Cookie expired or missing — send back to agent edit
    redirect(`/ai-employees/${agentId}?meta_error=session_expired`)
  }

  let pages: MetaPageData[] = []
  try {
    pages = JSON.parse(raw)
  } catch {
    redirect(`/ai-employees/${agentId}?meta_error=session_expired`)
  }

  if (!pages.length) notFound()

  return (
    <div className="flex items-start justify-center p-4 sm:p-6">
      <MetaPagePickerClient agentId={agentId} pages={pages} />
    </div>
  )
}
