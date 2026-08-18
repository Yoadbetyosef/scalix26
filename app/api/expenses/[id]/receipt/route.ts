import { NextResponse } from 'next/server'
import { receiptUrl } from '@/lib/expenses/store'

// OPENING A RECEIPT.
//
// A redirect to a signed URL that lives for ten minutes, minted per request. The bucket is private
// and the path never reaches the browser — see readExpenses, which deliberately returns `hasReceipt`
// rather than the storage key.
//
// The same 404 for "no such expense", "not yours" and "no receipt attached". Distinguishing them would
// let anyone with a session enumerate which ids exist on other tenants.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = await receiptUrl(id)
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.redirect(url)
}
