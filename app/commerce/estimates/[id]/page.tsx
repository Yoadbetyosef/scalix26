import { SalesDocDetail } from '@/components/commerce/sales-doc-detail'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SalesDocDetail type="estimate" id={(await params).id} />
}
