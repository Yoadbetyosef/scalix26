import { getIntegrationStates, type IntegrationState } from '@/lib/assistant/integrations'
import { DetailPage, type DetailSection } from '../../detail'
import { listPageContext } from '../../list-page'
import { connectionsLine } from './line'

// CONNECTIONS — one page where a person connects everything once.
//
// Grouped by CAPABILITY rather than by vendor: the heading says what it unlocks and the row underneath
// names the provider. A person does not wake up wanting to connect Twilio; they want Rudi to answer
// the phone.
//
// Each row states what is NOT possible without it. That is what makes someone finish setup — a red
// badge only says they have failed at something, which is both unkind and uninformative.
//
// READ-ONLY: this is the status view. The connect flows stay where they are until the page has been
// seen and the move is decided.

export const dynamic = 'force-dynamic'

interface Row {
  provider: string
  key: keyof Awaited<ReturnType<typeof getIntegrationStates>>
  /** What Rudi cannot do without it. Written from the owner's side, not the system's. */
  without: string
}

// The capability is the heading; the provider is the row. Nothing here is grouped by who sells it.
const CAPABILITIES: Array<{ heading: string; verb: string; rows: Row[] }> = [
  {
    heading: 'So Rudi can book',
    verb: 'book anything',
    rows: [
      { provider: 'Google Calendar', key: 'calendar', without: 'Rudi cannot see when you are free, so it cannot book.' },
      { provider: 'Outlook', key: 'outlook', without: 'A business on Microsoft cannot be booked into without this.' },
    ],
  },
  {
    heading: 'So Rudi can answer everywhere',
    verb: 'answer',
    rows: [
      { provider: 'Phone & SMS', key: 'twilio', without: 'No number to answer on, so calls and texts go nowhere.' },
      { provider: 'Email', key: 'email', without: 'Email arrives and nobody replies to it.' },
      { provider: 'Facebook', key: 'facebook', without: 'Messages to your page go unanswered.' },
      { provider: 'Instagram', key: 'instagram', without: 'Instagram DMs go unanswered.' },
    ],
  },
  {
    heading: 'So Rudi can bring you work',
    verb: 'take payment',
    rows: [
      { provider: 'Stripe', key: 'stripe', without: 'Rudi cannot send a payment link or take a deposit.' },
    ],
  },
]

const STATE_LABEL: Record<IntegrationState, string> = {
  live: 'Live',
  // The whole point of the third state: it says there is nothing for the person to do.
  review: 'In review · nothing for you to do',
  connect: 'Connect',
}

export default async function V2Connections() {
  const { tenantId } = await listPageContext()
  const states = await getIntegrationStates(tenantId)

  const all = CAPABILITIES.flatMap((c) => c.rows)
  const live = all.filter((r) => states[r.key] === 'live').length
  const review = all.filter((r) => states[r.key] === 'review').length
  // A capability is blocked only when NOTHING in it is connected — one calendar is enough to book.
  const blocked = CAPABILITIES.filter((c) => c.rows.every((r) => states[r.key] !== 'live')).map((c) => c.verb)

  const sections: DetailSection[] = CAPABILITIES.map((c) => ({
    title: c.heading,
    rows: c.rows.map((r) => ({
      id: r.key,
      primary: r.provider,
      // Live states what it does; anything else states what is missing without it. A connected row has
      // nothing to warn about, and repeating the warning there would be nagging.
      detail: states[r.key] === 'live' ? null : r.without,
      trailing: STATE_LABEL[states[r.key]],
    })),
  }))

  return (
    <DetailPage
      backHref="/v2"
      backLabel="Home"
      title="Connections"
      line={connectionsLine({ live, review, blocked })}
      sections={sections}
    />
  )
}
