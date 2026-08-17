import { NextRequest, NextResponse } from 'next/server'
import { invoiceFileUrl } from '@/lib/invoices/store'

// A short-lived signed URL so the owner can read the invoice beside the extracted lines. The bucket is
// private and stays private: the bytes never reach the browser except through a URL minted here, for
// this session, after the same gate every other read passes.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await invoiceFileUrl((await params).id)
  if (!r.ok) {
    return r.reason === 'forbidden'
      ? NextResponse.json({ error: 'You do not have permission to view supplier invoices.' }, { status: 403 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ url: r.data })
}
