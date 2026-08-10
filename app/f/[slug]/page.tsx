import { createServiceClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { Zap } from 'lucide-react'
import { BookingForm } from '@/components/booking/booking-form'

// Public hosted lead-capture page. Shareable link: /f/<slug>. Submitting it
// fires the existing Speed to Lead flow via /api/leads/inbound/<token>.
// The tenant's name, not ours — see lib/documents/routes.ts. This page's reader is the tenant's
// prospect, who has no idea who we are.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { data } = await createAdminClient()
      .from('tenants').select('business_name').eq('slug', (await params).slug).maybeSingle()
    return { title: (data?.business_name as string) || '', robots: { index: false, follow: false } }
  } catch {
    return { title: '' }
  }
}

export default async function BookingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name, lead_intake_token')
    .eq('slug', slug)
    .maybeSingle()

  if (!tenant) {
    // Backward-compat: old links used the UUID token — redirect to the slug
    const { data: byToken } = await supabase
      .from('tenants')
      .select('slug')
      .eq('lead_intake_token', slug)
      .maybeSingle()
    if (byToken?.slug) redirect(`/f/${byToken.slug}`)
    notFound()
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-hairline p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#5B6CF0] rounded-xl flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-ink">{tenant.business_name}</h1>
            <p className="text-subtle text-sm mt-1.5">Leave your details and we&apos;ll text you right back — usually within seconds.</p>
          </div>
          <BookingForm token={tenant.lead_intake_token} />
        </div>
        <p className="text-center text-xs text-muted mt-4">Powered by Scalix</p>
      </div>
    </div>
  )
}
