'use client'

import { CHARGE_TYPES, CREDIT_TYPES, signedAmount, type ChargeType, type OrderCharge } from '@/lib/orders/charges'

// ADDITIONAL CHARGES — the section under the items on the create form and the edit drawer. One row
// per charge: type, what the customer pays, what it cost us, a note. A discount or reimbursement is
// typed as a positive number and subtracts; an adjustment takes a minus sign when it goes down.
// See lib/orders/charges.ts for the model.

export interface ChargeDraft { chargeType: ChargeType; description: string; amount: string; cost: string }

export const emptyCharge = (): ChargeDraft => ({ chargeType: 'shipping', description: '', amount: '', cost: '' })

export const chargeFromSaved = (c: OrderCharge): ChargeDraft => ({
  chargeType: c.chargeType,
  description: c.description ?? '',
  // Credits are shown as the positive figure she typed; the sign comes from the type.
  amount: String((CREDIT_TYPES.has(c.chargeType) ? Math.abs(c.amountCents) : c.amountCents) / 100),
  cost: c.costCents == null ? '' : String(c.costCents / 100),
})

const cents = (v: string) => Math.round((parseFloat(v.replace(/[^0-9.-]/g, '')) || 0) * 100)

/** Rows with nothing typed in either amount are dropped — an empty row is not a $0 charge. */
export const chargesToPayload = (rows: ChargeDraft[]): OrderCharge[] => rows
  .filter((r) => r.amount.trim() !== '' || r.cost.trim() !== '' || r.description.trim() !== '')
  .map((r) => ({
    chargeType: r.chargeType,
    description: r.description.trim() || null,
    amountCents: signedAmount(r.chargeType, cents(r.amount)),
    costCents: r.cost.trim() === '' ? null : Math.abs(cents(r.cost)),
  }))

export const chargesDraftTotal = (rows: ChargeDraft[]): number =>
  chargesToPayload(rows).reduce((s, c) => s + c.amountCents, 0) / 100

export function ChargeFields({ rows, onChange, currencySymbol, idPrefix }: {
  rows: ChargeDraft[]
  onChange: (rows: ChargeDraft[]) => void
  currencySymbol: string
  idPrefix: string
}) {
  const set = (i: number, k: keyof ChargeDraft, v: string) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  return (
    <section>
      <div className="v2-head" style={{ marginBottom: 12 }}>
        <p className="v2-kick"><i />Additional charges · {rows.length}</p><s />
        <button type="button" className="v2-act" onClick={() => onChange([...rows, emptyCharge()])}>+ Add charge</button>
      </div>
      {rows.length === 0 && (
        <p className="v2-hint">Shipping, insurance, CAD/CAM, casting, certificates, fees, duties, discounts — anything on the invoice that is not the piece.</p>
      )}
      <div className="space-y-3">
        {rows.map((r, i) => {
          const p = `${idPrefix}-${i}`
          const credit = CREDIT_TYPES.has(r.chargeType)
          return (
            <div key={i} className="v2-form" style={{ gridTemplateColumns: 'minmax(170px, 1.2fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(160px, 1.5fr) auto', alignItems: 'end' }}>
              <div className="v2-fld">
                <label htmlFor={`${p}-type`}>Charge type</label>
                <span className="v2-sel">
                  <select id={`${p}-type`} value={r.chargeType} onChange={(e) => set(i, 'chargeType', e.target.value)}>
                    {CHARGE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </span>
              </div>
              <div className="v2-fld">
                <label htmlFor={`${p}-amount`}>{credit ? `Amount off (${currencySymbol})` : `Selling (${currencySymbol})`}</label>
                <input id={`${p}-amount`} inputMode="decimal" value={r.amount} onChange={(e) => set(i, 'amount', e.target.value)} placeholder="0" />
              </div>
              <div className="v2-fld">
                <label htmlFor={`${p}-cost`}>Cost ({currencySymbol})</label>
                <input id={`${p}-cost`} inputMode="decimal" value={r.cost} onChange={(e) => set(i, 'cost', e.target.value)} placeholder="internal" />
              </div>
              <div className="v2-fld">
                <label htmlFor={`${p}-desc`}>Description</label>
                <input id={`${p}-desc`} value={r.description} onChange={(e) => set(i, 'description', e.target.value)} placeholder="Printed on the invoice" />
              </div>
              <button type="button" className="v2-act" data-danger aria-label="Remove charge" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>Remove</button>
            </div>
          )
        })}
      </div>
      {rows.length > 0 && <p className="v2-hint" style={{ marginTop: 8 }}>Cost is internal and never printed. Discounts and reimbursements subtract; an adjustment can be negative.</p>}
    </section>
  )
}
