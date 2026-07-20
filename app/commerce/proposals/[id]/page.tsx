import { ProposalBuilder } from '@/components/commerce/proposal-builder'
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ProposalBuilder id={(await params).id} />
}
