import { getDashboardData } from '@/lib/dashboard/overview'
import { ListPage, type ListFilter, type ListRow } from '../list'
import { listPageContext, PREVIEW } from '../list-page'
import { appointmentsLine } from './line'

// Appointments, reskinned. getDashboardData already returns appointments_list — the same 100 rows the
// dashboard tab renders, in the same order — so this page adds no query.

export const dynamic = 'force-dynamic'

const FILTERS: ListFilter[] = [
  { id: 'upcoming', label: 'Upcoming', buckets: ['today', 'later'] },
  { id: 'today', label: 'Today', buckets: ['today'] },
  { id: 'past', label: 'Past', buckets: ['past'] },
  { id: 'cancelled', label: 'Cancelled', buckets: ['cancelled'] },
]

export default async function V2Appointments() {
  const { tenantId } = await listPageContext('scheduling')
  const { appointments_list } = await getDashboardData(tenantId)

  // slot_date is a plain date column, so it is compared as a STRING. Converting it through a Date would
  // introduce a timezone the column does not have — the same rule data.ts already follows.
  const today = new Date().toISOString().slice(0, 10)

  const rows: ListRow[] = appointments_list.map((a) => {
    const cancelled = a.status === 'cancelled'
    const bucket = cancelled ? 'cancelled' : a.slot_date === today ? 'today' : a.slot_date > today ? 'later' : 'past'
    return {
      id: a.id,
      primary: a.customer_name || 'Appointment',
      detail: [a.service_type, a.customer_phone || a.customer_email, a.channel].filter(Boolean).join(' · ') || 'Booked',
      // The date is the figure that matters here, not how long ago the row was written.
      trailing: [a.slot_date === today ? 'Today' : a.slot_date, a.slot_time].filter(Boolean).join(' '),
      trailingTone: bucket === 'today' ? 'positive' : null,
      marked: bucket === 'today',
      muted: cancelled || bucket === 'past',
      bucket,
      actions: [{ label: 'Open', tone: 'primary', disabledReason: PREVIEW }],
    }
  })

  return (
    <ListPage
      title="Appointments"
      line={appointmentsLine({
        today: rows.filter((r) => r.bucket === 'today').length,
        later: rows.filter((r) => r.bucket === 'later').length,
        next: rows.find((r) => r.bucket === 'today') ?? rows.find((r) => r.bucket === 'later') ?? null,
      })}
      filters={FILTERS}
      initialFilter="upcoming"
      rows={rows}
      backHref="/v2"
      empty={{ title: 'Nothing booked', body: 'Appointments Rudi books from a call or a message land here.' }}
    />
  )
}
