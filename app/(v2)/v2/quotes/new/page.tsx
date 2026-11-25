import { listPageContext } from '../../list-page'
import { QuoteEditor } from '../editor'

export const dynamic = 'force-dynamic'

export default async function NewQuote() {
  await listPageContext('invoices')
  return <QuoteEditor quote={null} />
}
