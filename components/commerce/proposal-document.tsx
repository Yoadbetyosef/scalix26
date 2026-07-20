import type { RenderableProposal, RenderLine } from '@/lib/core/proposal-render'

// Branded, customer-facing proposal document. Server component (pure presentation) so BOTH the public token
// page and the internal preview render identically. Three templates (clean / visual / minimal) + tenant
// branding (logo, accent, header style, footer). Inline styles so it renders correctly outside the app shell.
const fmt = (cents: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'usd' }).format(cents / 100)
const day = (d: string | null) => (d ? String(d).slice(0, 10) : null)

export function ProposalDocument({ proposal: p }: { proposal: RenderableProposal }) {
  const accent = p.branding.accent_color || '#5b6cf0'
  const tpl = p.template
  const imgSize = tpl === 'visual' ? 120 : tpl === 'minimal' ? 0 : 64
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.04)' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={card}>
        {/* Header */}
        <Header p={p} accent={accent} />

        {/* Meta: customer + dates */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', padding: '20px 28px', borderBottom: '1px solid #f0f1f3' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 4 }}>Prepared for</div>
            <div style={{ fontWeight: 600, color: '#111827' }}>{p.customer.name || '—'}</div>
            {p.customer.company && <div style={{ fontSize: 14, color: '#4b5563' }}>{p.customer.company}</div>}
            {p.customer.email && <div style={{ fontSize: 13, color: '#6b7280' }}>{p.customer.email}</div>}
            {p.customer.phone && <div style={{ fontSize: 13, color: '#6b7280' }}>{p.customer.phone}</div>}
            {p.customer.address && <div style={{ fontSize: 13, color: '#6b7280', whiteSpace: 'pre-wrap' }}>{p.customer.address}</div>}
          </div>
          <div style={{ textAlign: 'right' as const, fontSize: 13, color: '#6b7280' }}>
            <div><span style={{ color: '#9ca3af' }}>Proposal</span> <strong style={{ color: '#111827' }}>{p.number}</strong></div>
            {p.created_at && <div><span style={{ color: '#9ca3af' }}>Created</span> {day(p.created_at)}</div>}
            {p.expires_at && <div><span style={{ color: '#9ca3af' }}>Valid until</span> {day(p.expires_at)}</div>}
            <div style={{ marginTop: 6 }}><StatusPill status={p.status} /></div>
          </div>
        </div>

        {p.is_expired && <div style={{ background: '#fef2f2', color: '#b91c1c', fontSize: 14, padding: '10px 28px' }}>This proposal has expired. Please contact {p.branding.business_name} for an updated version.</div>}
        {p.intro && <div style={{ padding: '18px 28px', color: '#374151', fontSize: 15, whiteSpace: 'pre-wrap', borderBottom: '1px solid #f0f1f3' }}>{p.intro}</div>}

        {/* Line items */}
        <div>
          {p.lines.map((l, i) => <LineRow key={i} l={l} currency={p.currency} imgSize={imgSize} />)}
        </div>

        {/* Totals */}
        <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 28px', fontSize: 14 }}>
          <TotalRow label="Subtotal" value={fmt(p.subtotal_cents, p.currency)} />
          {p.discount_cents > 0 && <TotalRow label="Discount" value={`− ${fmt(p.discount_cents, p.currency)}`} />}
          {p.tax_cents > 0 && <TotalRow label="Tax" value={fmt(p.tax_cents, p.currency)} />}
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #e5e7eb' }}><TotalRow label="Total" value={fmt(p.total_cents, p.currency)} strong accent={accent} /></div>
        </div>

        {p.terms && <div style={{ borderTop: '1px solid #f0f1f3', padding: '18px 28px' }}><div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', marginBottom: 6 }}>Terms &amp; conditions</div><div style={{ fontSize: 13, color: '#4b5563', whiteSpace: 'pre-wrap' }}>{p.terms}</div></div>}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 28px', fontSize: 12, color: '#9ca3af', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
          <span>{[p.branding.business_name, p.branding.phone, p.branding.email, p.branding.website].filter(Boolean).join(' · ')}</span>
          {p.branding.footer_text && <span>{p.branding.footer_text}</span>}
        </div>
      </div>
    </div>
  )
}

function Header({ p, accent }: { p: RenderableProposal; accent: string }) {
  const style = p.branding.header_style
  const logo = p.branding.logo_url
  const name = <span style={{ fontSize: 18, fontWeight: 700, color: style === 'band' ? '#fff' : '#111827' }}>{p.branding.business_name}</span>
  // eslint-disable-next-line @next/next/no-img-element
  const logoEl = logo ? <img src={logo} alt="" style={{ height: 40, maxWidth: 180, objectFit: 'contain' }} /> : null
  if (style === 'band') return <div style={{ background: accent, padding: '22px 28px', display: 'flex', alignItems: 'center', gap: 14 }}>{logoEl}{!logo && name}</div>
  if (style === 'centered') return <div style={{ padding: '26px 28px', textAlign: 'center', borderBottom: `3px solid ${accent}` }}>{logoEl || name}<h1 style={{ fontSize: 22, fontWeight: 300, color: '#111827', margin: '10px 0 0' }}>Proposal</h1></div>
  return <div style={{ padding: '22px 28px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: `3px solid ${accent}` }}>{logoEl}{name}</div>
}

function LineRow({ l, currency, imgSize }: { l: RenderLine; currency: string; imgSize: number }) {
  const title = l.description || [l.product_name, l.component_name, l.variant_name].filter(Boolean).join(' — ') || 'Item'
  const specs = [l.color && `Color: ${l.color}`, l.fabric && `Fabric: ${l.fabric}`, l.measurements && `Size: ${l.measurements}`, ...Object.entries(l.attributes).map(([k, v]) => `${k}: ${v}`)].filter(Boolean)
  return (
    <div style={{ display: 'flex', gap: 18, padding: '16px 28px', borderBottom: '1px solid #f0f1f3', alignItems: 'flex-start' }}>
      {imgSize > 0 && (l.image_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={l.image_url} alt="" style={{ width: imgSize, height: imgSize, objectFit: 'cover', borderRadius: 10, border: '1px solid #e5e7eb', flexShrink: 0 }} />
        : <div style={{ width: imgSize, height: imgSize, borderRadius: 10, background: '#f3f4f6', flexShrink: 0 }} />)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: '#111827' }}>{title}</div>
        {l.sku && <div style={{ fontSize: 12, color: '#9ca3af' }}>SKU {l.sku}</div>}
        {specs.length > 0 && <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>{specs.join(' · ')}</div>}
        <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{l.quantity} × {fmt(l.unit_price_cents, currency)}{l.discount_cents ? ` − ${fmt(l.discount_cents, currency)}` : ''}</div>
      </div>
      <div style={{ fontWeight: 600, color: '#111827', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt(l.line_total_cents, currency)}</div>
    </div>
  )
}

function TotalRow({ label, value, strong, accent }: { label: string; value: string; strong?: boolean; accent?: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span style={{ color: '#6b7280' }}>{label}</span><span style={{ fontWeight: strong ? 700 : 400, color: strong ? (accent || '#111827') : '#111827', fontSize: strong ? 18 : 14 }}>{value}</span></div>
}
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string[]> = { sent: ['#dbeafe', '#1d4ed8'], viewed: ['#dbeafe', '#1d4ed8'], accepted: ['#dcfce7', '#15803d'], declined: ['#fee2e2', '#b91c1c'], expired: ['#fee2e2', '#b91c1c'], converted: ['#ede9fe', '#6d28d9'], draft: ['#f3f4f6', '#6b7280'] }
  const [bg, fg] = map[status] ?? ['#f3f4f6', '#6b7280']
  return <span style={{ background: bg, color: fg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{status}</span>
}
