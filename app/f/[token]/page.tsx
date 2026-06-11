import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Zap } from 'lucide-react'
import { BookingForm } from '@/components/booking/booking-form'

// Public hosted lead-capture page. Shareable link: /f/<token>. Submitting it
// fires the existing Speed to Lead flow via /api/leads/inbound/<token>.
export default async function BookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const supabase = await createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_name')
    .eq('lead_intake_token', token)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="w-12 h-12 bg-[#4ecdc4] rounded-xl flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{tenant.business_name}</h1>
            <p className="text-gray-500 text-sm mt-1.5">Leave your details and we&apos;ll text you right back — usually within seconds.</p>
          </div>
          <BookingForm token={token} />
        </div>
        <p className="text-center text-xs text-gray-400 mt-4">Powered by Scalix</p>
      </div>
    </div>
  )
}
