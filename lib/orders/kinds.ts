// WHAT KIND OF JOB AN ORDER IS. Isomorphic: labels and the appraisal purposes, no server imports.
//
// A repair and an appraisal are ORDERS — same customer, same stages, same payments, same documents,
// same permanent history on the person. The kind changes a few words on the form and the document
// and, for an appraisal, adds a purpose. One column and a JSON pocket; no second table, no second
// board, no second customer record. See add_tg_production_1.sql part 6.

export const ORDER_KINDS = ['custom', 'repair', 'appraisal', 'stock'] as const
export type OrderKind = (typeof ORDER_KINDS)[number]
export const isOrderKind = (v: unknown): v is OrderKind => typeof v === 'string' && (ORDER_KINDS as readonly string[]).includes(v)

export const ORDER_KIND_LABELS: Record<OrderKind, string> = {
  custom: 'Custom / made piece', repair: 'Repair', appraisal: 'Appraisal', stock: 'Stock sale',
}

export const APPRAISAL_PURPOSES = ['insurance', 'estate', 'value_confirmation', 'purchase_verification', 'sale_consideration', 'other'] as const
export type AppraisalPurpose = (typeof APPRAISAL_PURPOSES)[number]
export const APPRAISAL_PURPOSE_LABELS: Record<AppraisalPurpose, string> = {
  insurance: 'Insurance', estate: 'Estate / probate', value_confirmation: 'Value confirmation',
  purchase_verification: 'Purchase verification', sale_consideration: 'Sale consideration', other: 'Other',
}

/** The kind-specific pocket. Every field optional; unknown keys are kept as they are. */
export interface KindDetails {
  /** repair + appraisal: what the customer brought in, in their words. */
  itemDescription?: string | null
  /** repair: what they asked for. */
  repairRequested?: string | null
  /** appraisal */
  purpose?: AppraisalPurpose | null
  appraiser?: string | null
  [key: string]: unknown
}

/** The words the form and the document use for the piece and the brief, by kind. */
export function kindWords(kind: OrderKind): { piece: string; brief: string; blurb: string } {
  switch (kind) {
    case 'repair': return { piece: 'Item brought in', brief: 'Repair requested', blurb: 'Repair of the piece(s) described below.' }
    case 'appraisal': return { piece: 'Item to appraise', brief: 'Appraisal notes', blurb: 'Appraisal of the piece(s) described below.' }
    case 'stock': return { piece: 'Piece', brief: 'Notes', blurb: 'The piece(s) described below.' }
    default: return { piece: 'Piece', brief: 'The brief', blurb: '' }
  }
}
