import { createAdminClient } from '@/lib/supabase/server'
import { hexColor } from '@/lib/studio/types'
import type { OrderLineItem, OrderWithDetails } from './types'

// Estimates and Quotes generated from an order. Both are printed to PDF in the browser (the same route
// the Studio documents already take) and are often handed to an insurer, so every jewelry attribute the
// order carries is spelled out on the page — that detail IS the appraisal.
//
// The document is rendered live from the order rather than snapshotted: the order is already the record
// of truth, and a stale copy of it would be worse than none.

export const ORDER_DOC_TYPES = ['estimate', 'quote'] as const
export type OrderDocType = (typeof ORDER_DOC_TYPES)[number]
export const isOrderDocType = (v: unknown): v is OrderDocType =>
  typeof v === 'string' && (ORDER_DOC_TYPES as readonly string[]).includes(v)

export const ORDER_DOC_META: Record<OrderDocType, { title: string; blurb: string }> = {
  estimate: { title: 'Estimate', blurb: 'Estimated value of the piece(s) described below.' },
  quote: { title: 'Quote', blurb: 'Quoted price for the piece(s) described below.' },
}

export interface DocBranding { logoUrl: string | null; accent: string | null; terms: string | null; validityDays: number }
export interface DocBusiness {
  businessName: string | null; email: string | null; phone: string | null; website: string | null
  address: string | null; city: string | null; state: string | null; zip: string | null
}

// Document branding is tenant-wide and shared with the Studio documents, so a logo uploaded once shows
// up everywhere. Falls back to an unbranded but complete document.
export async function loadDocContext(tenantId: string): Promise<{ branding: DocBranding; business: DocBusiness }> {
  const db = createAdminClient()
  const [{ data: s }, { data: t }] = await Promise.all([
    db.from('studio_doc_settings').select('logo_url, accent_color, terms, validity_days').eq('tenant_id', tenantId).maybeSingle(),
    db.from('tenants').select('business_name, email, phone, website, address, city, state, zip').eq('id', tenantId).maybeSingle(),
  ])
  return {
    branding: {
      logoUrl: (s?.logo_url as string) ?? null,
      accent: hexColor(s?.accent_color),
      terms: (s?.terms as string) ?? null,
      validityDays: Number(s?.validity_days ?? 30) || 30,
    },
    business: {
      businessName: (t?.business_name as string) ?? null, email: (t?.email as string) ?? null,
      phone: (t?.phone as string) ?? null, website: (t?.website as string) ?? null,
      address: (t?.address as string) ?? null, city: (t?.city as string) ?? null,
      state: (t?.state as string) ?? null, zip: (t?.zip as string) ?? null,
    },
  }
}

// Human document reference, stable for a given order + type: EST-1024 / QOT-1024.
export const orderDocNumber = (type: OrderDocType, orderNumber: string): string =>
  `${type === 'estimate' ? 'EST' : 'QOT'}-${orderNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-8) || 'PIECE'}`

// Attribute rows for one line item — the itemised description an insurer expects, with the empty
// attributes dropped rather than printed as blanks.
export function specRows(l: OrderLineItem): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Stone', l.stoneType],
    ['Origin', l.stoneOrigin],
    ['Quality', l.stoneQuality],
    ['Colour', l.stoneColor],
    ['Center shape', l.centerStoneShape],
    ['Center weight', l.centerStoneCarat != null ? `${l.centerStoneCarat} ct` : null],
    ['Side shape', l.sideStoneShape],
    ['Side weight (total)', l.sideStoneCaratTotal != null ? `${l.sideStoneCaratTotal} ct` : null],
    ['Metal', l.metalKarat ?? l.material],
    ['Measurements', l.measurements],
    ['Finish', l.color],
    ['SKU', l.sku],
    ['Notes', l.customSpec],
  ]
  return rows.filter((r): r is [string, string] => Boolean(r[1]))
}

// Total carat weight across the whole document — the first number an insurer looks for.
export const totalCarats = (items: OrderLineItem[]): number =>
  items.reduce((s, l) => s + (l.centerStoneCarat ?? 0) * (l.quantity || 1) + (l.sideStoneCaratTotal ?? 0) * (l.quantity || 1), 0)

export const validUntil = (from: string, days: number): string =>
  new Date(new Date(from).getTime() + days * 86_400_000).toISOString().slice(0, 10)

export type OrderForDoc = OrderWithDetails
