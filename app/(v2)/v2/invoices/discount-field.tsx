'use client'

// A DISCOUNT ON THE WHOLE INVOICE — percent or dollars, the owner's choice.
//
// Optional. Left empty, nothing about a discount appears anywhere on the customer's copy. The value is
// a string while typing; `toDiscount` turns it into what the server takes, or null when empty/zero.
// The cents are the SERVER'S sum (lib/core/money.ts) — this only says which kind and how much.

export type DiscountKind = 'percent' | 'amount'

export function toDiscount(kind: DiscountKind, value: string): { kind: DiscountKind; value: number } | null {
  const n = Number(String(value).replace(/[^0-9.]/g, '')) || 0
  if (n <= 0) return null
  return { kind, value: kind === 'percent' ? Math.min(100, n) : Math.round(n * 100) / 100 }
}

export function DiscountField({
  kind, value, onKind, onValue, disabled, trailing,
}: {
  kind: DiscountKind
  value: string
  onKind: (k: DiscountKind) => void
  onValue: (v: string) => void
  disabled?: boolean
  trailing?: React.ReactNode
}) {
  return (
    <div className="v2-iv-disc">
      <span className="v2-iv-disc-l">Discount</span>
      <div className="v2-iv-disc-k" role="group" aria-label="Discount type">
        <button type="button" data-on={kind === 'percent' || undefined} onClick={() => onKind('percent')} disabled={disabled}>%</button>
        <button type="button" data-on={kind === 'amount' || undefined} onClick={() => onKind('amount')} disabled={disabled}>$</button>
      </div>
      <input
        className="v2-iv-fld" value={value} inputMode="decimal" disabled={disabled}
        placeholder={kind === 'percent' ? 'e.g. 10' : 'e.g. 250.00'}
        onChange={(e) => onValue(e.target.value)}
        aria-label={kind === 'percent' ? 'Discount percent' : 'Discount amount in dollars'}
      />
      {trailing}
    </div>
  )
}
