import { redirect } from 'next/navigation'
// Old quote detail URL → unified proposal detail (resolves the legacy quote by id, read-only).
export default async function Page({ params }: { params: Promise<{ id: string }> }) { redirect(`/commerce/proposals/${(await params).id}`) }
