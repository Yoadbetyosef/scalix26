import { CustomerDetail } from '@/components/commerce/customer-detail'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CustomerDetail id={(await params).id} />
}
