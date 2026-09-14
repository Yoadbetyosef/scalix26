'use client'

import { APPRAISAL_PURPOSES, APPRAISAL_PURPOSE_LABELS, ORDER_KINDS, ORDER_KIND_LABELS, kindWords, type KindDetails, type OrderKind } from '@/lib/orders/kinds'

// The "what kind of job is this" control and the few fields that follow from it, shared by the
// create form and the edit drawer so the two cannot ask different questions.
//
// A repair asks what was brought in and what was asked for; an appraisal asks the same plus the
// purpose and who is appraising. Both are ORDERS underneath — the same stages, the same money —
// which is why this is a section on the order form and not a form of its own.

export interface KindDraft { kind: OrderKind; details: KindDetails }
export const emptyKind = (): KindDraft => ({ kind: 'custom', details: {} })

export function KindFields({ value, onChange, idPrefix = 'kind' }: { value: KindDraft; onChange: (v: KindDraft) => void; idPrefix?: string }) {
  const d = value.details
  const setD = (k: keyof KindDetails, v: string) => onChange({ ...value, details: { ...d, [k]: v || null } })
  const words = kindWords(value.kind)
  return (
    <section>
      <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick"><i />Kind of job</p><s /></div>
      <div className="flex flex-wrap gap-2">
        {ORDER_KINDS.map((k) => (
          <button key={k} type="button" className="v2-chip" data-on={value.kind === k || undefined} onClick={() => onChange({ ...value, kind: k })}>{ORDER_KIND_LABELS[k]}</button>
        ))}
      </div>
      {(value.kind === 'repair' || value.kind === 'appraisal') && (
        <div className="v2-form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: 12 }}>
          <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor={`${idPrefix}-item`}>{words.piece}</label>
            <input id={`${idPrefix}-item`} value={d.itemDescription ?? ''} onChange={(e) => setD('itemDescription', e.target.value)} placeholder={value.kind === 'repair' ? 'e.g. 14K yellow gold ring, prong lifted, stone loose' : 'e.g. Ladies Rolex Datejust 26mm, steel and gold'} /></div>
          {value.kind === 'repair' && (
            <div className="v2-fld" style={{ gridColumn: '1 / -1' }}><label htmlFor={`${idPrefix}-req`}>{words.brief}</label>
              <textarea id={`${idPrefix}-req`} value={d.repairRequested ?? ''} onChange={(e) => setD('repairRequested', e.target.value)} rows={3} placeholder="Re-tip two prongs, tighten centre stone, polish" /></div>
          )}
          {value.kind === 'appraisal' && (
            <>
              <div className="v2-fld"><label htmlFor={`${idPrefix}-purpose`}>Purpose</label>
                <span className="v2-sel"><select id={`${idPrefix}-purpose`} value={d.purpose ?? ''} onChange={(e) => setD('purpose', e.target.value)}>
                  <option value="">—</option>
                  {APPRAISAL_PURPOSES.map((p) => <option key={p} value={p}>{APPRAISAL_PURPOSE_LABELS[p]}</option>)}
                </select></span></div>
              <div className="v2-fld"><label htmlFor={`${idPrefix}-appraiser`}>Appraiser</label>
                <input id={`${idPrefix}-appraiser`} value={d.appraiser ?? ''} onChange={(e) => setD('appraiser', e.target.value)} /></div>
            </>
          )}
          <p className="v2-hint" style={{ gridColumn: '1 / -1' }}>
            Photos of the piece go on Attachments once the order exists. The line items below carry the price — one line for the {value.kind === 'repair' ? 'repair' : 'appraisal'} is enough.
          </p>
        </div>
      )}
    </section>
  )
}
