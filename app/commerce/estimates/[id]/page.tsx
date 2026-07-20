import { redirect } from 'next/navigation'
// Old estimate detail URL → unified proposal detail (resolves the legacy estimate by id, read-only).
export default async function Page({ params }: { params: Promise<{ id: string }> }) { redirect(`/commerce/proposals/${(await params).id}`) }
