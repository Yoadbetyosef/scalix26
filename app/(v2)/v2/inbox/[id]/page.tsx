import { notFound } from 'next/navigation'
import { ConversationBody } from './body'
import { listPageContext } from '../../list-page'

// A thin route over the shared body. The same component renders in the two-pane list's right side, so
// a detail is one implementation reachable two ways.
//
// notFound() lives HERE and not in the body: as a route this is the correct answer, and from inside a
// client component's prop the same throw is not a routing signal and blanks the screen instead.
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('inbox')
  const body = await ConversationBody({ tenantId, id: (await params).id })
  if (!body) notFound()
  return body
}
