import { redirect } from 'next/navigation'
import { readQuote } from '@/lib/core/quotes'
import { listPageContext } from '../../list-page'
import { QuoteEditor } from '../editor'
import { tenantSalesTax } from '@/lib/core/documents'

export const dynamic = 'force-dynamic'

export default async function V2Quote({ params }: { params: Promise<{ id: string }> }) {
  const { tenantId } = await listPageContext('invoices')
  const [quote, tax] = await Promise.all([readQuote(tenantId, (await params).id), tenantSalesTax(tenantId)])
  // Deleted, or an old link: back to the list rather than a dead-end 404.
  if (!quote) redirect('/v2/quotes')
  // Keyed on what was last saved, so a refresh after Save or Send re-seeds the form from the server.
  return <QuoteEditor key={`${quote.id}:${quote.sentAt ?? ''}:${quote.state}:${quote.totalCents}:${quote.taxCents}:${quote.invoiceId ?? ''}`} quote={quote} tax={tax ? { rate: tax.rate, label: tax.label } : null} />
}
