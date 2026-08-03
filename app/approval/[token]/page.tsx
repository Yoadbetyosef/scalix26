import { Fragment } from 'react'
import { getApprovalByToken } from '@/lib/orders/approvals'
import type { PublicOrderView } from '@/lib/orders/types'
import { PublicApprovalForm } from '@/components/orders/public-approval'
import { FactoryDelivery } from '@/components/orders/factory-delivery'

export const dynamic = 'force-dynamic'

// PUBLIC approval page — reachable only with a valid token. No tenant data, internal notes, internal IDs, or
// other orders are ever exposed. Invalid/expired/revoked tokens get a single generic page.
function Unavailable() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 440, padding: 28, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#111827' }}>Link unavailable</h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>This approval link is invalid, has expired, or is no longer available. If you believe this is a mistake, please contact the sender.</p>
      </div>
    </div>
  )
}

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token
  const view = await getApprovalByToken(token)
  if (!view) return <Unavailable />

  // The factory cannot make the piece from a product name alone — every spec the order carries is listed
  // as its own labelled row. Pricing and internal notes stay out; these are manufacturing instructions.
  const specRows = (l: PublicOrderView['lineItems'][number]): Array<[string, string]> => ([
    ['Stone', l.stoneType],
    ['Natural / Lab', l.stoneOrigin],
    ['Quality', l.stoneQuality],
    ['Colour', l.stoneColor],
    ['Center shape', l.centerStoneShape],
    ['Center weight', l.centerStoneCarat != null ? `${l.centerStoneCarat} ct` : null],
    ['Side shape', l.sideStoneShape],
    ['Side weight (total)', l.sideStoneCaratTotal != null ? `${l.sideStoneCaratTotal} ct` : null],
    ['Metal', l.metalKarat ?? l.material],
    ['Measurements', l.measurements],
    ['Finish', l.color],
    ['Notes', l.customSpec],
  ] as Array<[string, string | null]>).filter((r): r is [string, string] => Boolean(r[1]))
  const responded = ['approved', 'changes_requested', 'rejected'].includes(view.status)
  const isImage = (m: string) => m.startsWith('image/') && m !== 'image/heic' && m !== 'image/heif'

  return (
    <div style={{ minHeight: '100vh', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{view.businessName}</div>
          <h1 style={{ fontSize: 22, margin: '8px 0 2px', color: '#111827' }}>Order {view.order.orderNumber}</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>You are reviewing this order as the {view.approvalType}.{view.deadline ? ` Please respond by ${new Date(view.deadline).toLocaleDateString()}.` : ''}</p>
          {view.order.customerName && <p style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 0' }}>Customer: {view.order.customerName}</p>}

          <h2 style={{ fontSize: 14, margin: '20px 0 8px', color: '#111827' }}>Items</h2>
          <div style={{ border: '1px solid #eef0f2', borderRadius: 10, overflow: 'hidden' }}>
            {view.order.lineItems.map((l, i) => (
              <div key={i} style={{ padding: 12, borderTop: i ? '1px solid #f1f2f4' : 'none' }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{l.productName} <span style={{ fontWeight: 400, color: '#6b7280' }}>× {l.quantity}</span></div>
                {l.description && <div style={{ fontSize: 13, color: '#6b7280' }}>{l.description}</div>}
                {specRows(l).length > 0 && (
                  <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 3, margin: '8px 0 0', fontSize: 12 }}>
                    {specRows(l).map(([k, v]) => (
                      <Fragment key={k}>
                        <dt style={{ color: '#9ca3af' }}>{k}</dt>
                        <dd style={{ margin: 0, color: '#374151', fontWeight: 500 }}>{v}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
              </div>
            ))}
            {view.order.lineItems.length === 0 && <div style={{ padding: 12, fontSize: 13, color: '#9ca3af' }}>No items listed.</div>}
          </div>

          {view.order.publicNotes && <><h2 style={{ fontSize: 14, margin: '18px 0 6px', color: '#111827' }}>Notes</h2><p style={{ fontSize: 13, color: '#4b5563', margin: 0 }}>{view.order.publicNotes}</p></>}

          {/* Reference photos, sketches and CAD renders are the point of a factory approval, so images are
              shown inline rather than as a filename the recipient has to think to click. */}
          {view.attachments.length > 0 && (
            <>
              <h2 style={{ fontSize: 14, margin: '18px 0 6px', color: '#111827' }}>Reference files</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {view.attachments.map((a, i) => (
                  <a key={i} href={a.url ?? '#'} target="_blank" rel="noreferrer" style={{ display: 'block', border: '1px solid #eef0f2', borderRadius: 10, overflow: 'hidden', textDecoration: 'none' }}>
                    {isImage(a.mimeType) && a.url
                      // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static asset
                      ? <img src={a.url} alt={a.fileName} style={{ display: 'block', width: '100%', height: 120, objectFit: 'cover' }} />
                      : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', fontSize: 11, color: '#9ca3af' }}>{a.fileName.split('.').pop()?.toUpperCase() ?? 'FILE'}</div>}
                    <div style={{ padding: '6px 8px', fontSize: 11, color: '#2563eb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName}</div>
                  </a>
                ))}
              </div>
            </>
          )}

          {view.canSubmitDelivery ? (
            <>
              <h2 style={{ fontSize: 14, margin: '22px 0 8px', color: '#111827' }}>Mark ready & upload invoice</h2>
              <FactoryDelivery token={token} />
            </>
          ) : view.deliverySubmitted ? (
            <div style={{ marginTop: 20, padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 14, color: '#166534' }}>This order is marked <strong>ready</strong> and your invoice was received. Thank you — nothing further is needed.</div>
          ) : (
            <>
              {responded && <div style={{ marginTop: 18, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, fontSize: 13, color: '#166534' }}>Your response was recorded: <strong>{view.status.replace('_', ' ')}</strong>.{view.existingResponse?.comment ? ` "${view.existingResponse.comment}"` : ''} You can update it below if needed.</div>}
              <h2 style={{ fontSize: 14, margin: '20px 0 8px', color: '#111827' }}>Your decision</h2>
              {view.canRespond ? <PublicApprovalForm token={token} approvalType={view.approvalType} /> : <p style={{ fontSize: 13, color: '#9ca3af' }}>This request is no longer open for responses.</p>}
            </>
          )}
        </div>
        <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', margin: '14px 0 0' }}>Secure approval link · {view.businessName}</p>
      </div>
    </div>
  )
}
