import { notFound } from 'next/navigation'
import { OrderBody } from './body'

// See the inbox route: notFound() is the route's decision, never the body's.
export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const body = await OrderBody({ id: (await params).id })
  if (!body) notFound()
  return body
}
