import { listPageContext } from '../../list-page'
import { QuoteEditor } from '../editor'
import { tenantSalesTax } from '@/lib/core/documents'

export const dynamic = 'force-dynamic'

export default async function NewQuote() {
  const { tenantId } = await listPageContext('invoices')
  const tax = await tenantSalesTax(tenantId)
  return <QuoteEditor quote={null} tax={tax ? { rate: tax.rate, label: tax.label } : null} />
}
