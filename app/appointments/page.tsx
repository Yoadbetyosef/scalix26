import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import { AppointmentsTable } from '@/components/dashboard/appointments-table'
import { getDashboardData } from '@/lib/dashboard/overview'

/**
 * APPOINTMENTS, AT LAST GIVEN A PAGE OF ITS OWN.
 *
 * It never had one. The only way to see the schedule was /dashboard?tab=appointments — a tab strip
 * under the hero — and that is why the rail's Appointments row has been rendered INERT since the
 * shell was reskinned: "a row that goes nowhere is honest. A row pointed at an approximate page is
 * not." Deleting the tab strip without this would have deleted the schedule with it.
 *
 * So the tab moved rather than went. Same query, same component, same rows — `getDashboardData`'s
 * `appointments_list`, unchanged. What it gains is a URL, a place in the rail, and its own module
 * gate on `scheduling`, which the tab only ever had by way of the dashboard's own check.
 *
 * The TABLE is still v1's. This page exists so the move loses nothing; the V2 migration of what is
 * inside it is the next piece of work.
 */
export default async function AppointmentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  const { appointments_list } = await getDashboardData(tenantId)

  return (
    <div className="p-4 sm:p-6">
      <AppointmentsTable appointments={appointments_list} />
    </div>
  )
}
