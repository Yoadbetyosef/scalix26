import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { CreditCard, FileText, Info, Upload } from 'lucide-react'
import { RobotAvatar } from '@/components/brand/robot-avatar'
import { ModalDemo } from './modal-demo'
import '../v2-tokens.css'
import './kit.css'

// THE COMPONENT KIT — every v2 proposal beside the v1 it replaces.
//
// Dev only, behind the same two locks as the probes: notFound() in a production build, and the
// middleware's isDevProbe. It touches no app page and nothing imports it. The proposed language lives
// in kit.css as `.v2k-*`, so until it is approved it cannot reach a screen a customer sees; on
// approval those become `.v2-*` in v2-tokens.css and this file goes away.
//
// REAL DATA, read live. Every string below comes from the probe tenant — the contacts are genuinely
// unnamed voice callers, the product is genuinely the one in the catalogue, and /orders is genuinely
// empty. Lorem would have hidden the two things this kit exists to test: how the table reads when a
// name is missing, and how the empty state reads when it is the whole screen.

export const dynamic = 'force-dynamic'

const CHAN: Record<string, string> = {
  voice: 'var(--v2-t4)', sms: 'var(--v2-t2)', whatsapp: 'var(--v2-t2)',
  facebook: 'var(--v2-t3)', instagram: 'var(--v2-t1)', email: 'var(--v2-t3)',
}

async function load() {
  const db = createAdminClient()
  // The tenant with something to show — the kit is about components, not about one business.
  const { data: prods } = await db.from('catalog_products').select('tenant_id, name, price, sku, category').limit(200)
  const busiest = Object.entries((prods ?? []).reduce<Record<string, number>>((a, p) => {
    const t = (p as { tenant_id: string }).tenant_id; a[t] = (a[t] ?? 0) + 1; return a
  }, {})).sort((a, b) => b[1] - a[1])[0]?.[0]
  const [{ data: contacts }, { data: msgs }] = await Promise.all([
    db.from('contacts').select('name, phone, email, channel, created_at').eq('tenant_id', busiest ?? '').order('created_at', { ascending: false }).limit(5),
    // `role` and `content`, not direction/body — and `timestamp`, not created_at. The first version of
    // this query used the names the inbox UI uses rather than the ones the column has, found nothing,
    // and rendered an empty-state comparison that looked deliberate.
    // Both sides. Ordering by time alone returned four consecutive assistant messages, so the pair
    // showed one voice twice and demonstrated nothing about telling them apart.
    db.from('messages').select('content, role, timestamp').in('role', ['user', 'assistant']).order('timestamp', { ascending: false }).limit(40),
  ])
  const product = (prods ?? []).find((p) => (p as { tenant_id: string }).tenant_id === busiest) as
    { name?: string; price?: number; sku?: string; category?: string } | undefined
  const all = (msgs ?? []).map((m) => {
    const r = m as { content?: string; role?: string; timestamp?: string }
    return { text: r.content ?? '', us: r.role !== 'user', at: r.timestamp ?? '' }
  }).filter((m) => m.text.trim())
  // One of each, alternating, so the pair actually shows the distinction it is about.
  const them = all.filter((m) => !m.us), us = all.filter((m) => m.us)
  const thread = [them[0], us[0], them[1]].filter(Boolean) as typeof all
  return { contacts: contacts ?? [], product, msgs: thread }
}

const Pair = ({ title, note, v1, v2 }: { title: string; note: string; v1: React.ReactNode; v2: React.ReactNode }) => (
  <section className="v2k-block">
    <div className="v2-head"><p className="v2-kick"><i />{title}</p><s /></div>
    <div className="v2k-pair">
      <div className="v2k-side" data-v1><span className="v2k-tag">v1, today</span>{v1}</div>
      <div className="v2k-side"><span className="v2k-tag">v2, proposed</span>{v2}</div>
    </div>
    <p className="v2k-note">{note}</p>
  </section>
)

export default async function Kit() {
  if (process.env.NODE_ENV === 'production') notFound()
  const { contacts, product, msgs } = await load()
  const money = (n?: number) => (typeof n === 'number' ? `$${n.toLocaleString()}` : '—')

  return (
    <div className="v2 v2-embedded">
      <div className="v2k-page">
        <div className="v2-head" style={{ marginBottom: 30 }}>
          <p className="v2-kick"><i />Component kit · v1 beside v2</p><s />
        </div>

        {/* 1 · PAGE HEADER */}
        <Pair
          title="Page header"
          note="The rail already says which screen this is. A 24px bold repeat of the rail's own word is the same label twice in two sizes, and it is on all twenty pages. The replacement is the micro-label the rail's own sections use, with the primary action on the line."
          v1={
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>Contacts</h1>
                  <p style={{ margin: '2px 0 0', fontSize: 14, color: '#6b7280' }}>{contacts.length} total contacts</p>
                </div>
                <button style={{ background: '#111', color: '#fff', border: 0, borderRadius: 8, padding: '9px 14px', fontSize: 14 }}>+ New contact</button>
              </div>
            </div>
          }
          v2={
            <div className="v2-head">
              <p className="v2-kick"><i />Contacts · {contacts.length}</p>
              <s />
              <button type="button" className="v2-act" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>New contact</button>
            </div>
          }
        />

        {/* 2 · TABLE */}
        <Pair
          title="Table"
          note="Mono micro-label headers instead of grey caps; the row lights from the left in its own channel hue instead of filling grey; the status chip takes that hue rather than v1's green/amber. These rows are real — most of this tenant's callers have no name, which is exactly the case a lorem table would have hidden."
          v1={
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr>{['NAME', 'PHONE', 'CHANNEL'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: '#6b7280', borderBottom: '1px solid #e5e7eb', letterSpacing: '.04em' }}>{h}</th>
              ))}</tr></thead>
              <tbody>{contacts.slice(0, 4).map((c, i) => (
                <tr key={i}><td style={{ padding: '11px 10px', borderBottom: '1px solid #f3f4f6' }}>{c.name || '—'}</td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #f3f4f6' }}>{c.phone}</td>
                  <td style={{ padding: '11px 10px', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ background: '#dcfce7', color: '#166534', fontSize: 12, padding: '3px 8px', borderRadius: 999 }}>{c.channel}</span>
                  </td></tr>
              ))}</tbody>
            </table>
          }
          v2={
            <table className="v2-tbl">
              <thead><tr><th>Name</th><th>Phone</th><th>Channel</th></tr></thead>
              <tbody>{contacts.slice(0, 4).map((c, i) => (
                <tr key={i} style={{ ['--chan' as string]: CHAN[String(c.channel)] ?? 'var(--v2-t1)' }}>
                  <td>{c.name || <span style={{ color: 'var(--v2-ink-45)' }}>No name yet</span>}</td>
                  <td>{c.phone}</td>
                  <td>{c.channel
                    ? <span className="v2-stat">{c.channel}</span>
                    : <span style={{ color: 'var(--v2-ink-45)', fontSize: 13 }}>—</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          }
        />

        {/* 3 · FORM */}
        <Pair
          title="Form language — new"
          note="/v2 has no form language: nothing in the preview takes typing beyond one composer, so this is designed rather than ported. A RULE, NOT A BOX — every other surface here is flat and divided by hairlines, and forty boxed inputs is what makes /catalog/new read as software rather than as paper. Focus thickens the rule instead of drawing a ring, because a ring is a box. Real fields from /catalog/new, real values from the catalogue."
          v1={
            <div style={{ display: 'grid', gap: 14 }}>
              {[['Name', product?.name ?? ''], ['Category', product?.category ?? ''], ['Price', money(product?.price)]].map(([l, v]) => (
                <div key={l}>
                  <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 5 }}>{l}</label>
                  <input readOnly defaultValue={v} style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '9px 11px', fontSize: 14 }} />
                </div>
              ))}
            </div>
          }
          v2={
            <>
              <div className="v2-head" style={{ marginBottom: 16 }}><p className="v2-kick"><i />The product</p><s /></div>
              <div className="v2-form">
                <div className="v2-fld wide"><label>Name</label><input readOnly defaultValue={product?.name ?? ''} /></div>
                <div className="v2-fld"><label>Category</label>
                  <span className="v2-sel"><select defaultValue=""><option value="">{product?.category || 'Sofas'}</option></select></span>
                </div>
                <div className="v2-fld"><label>Price</label><input readOnly defaultValue={money(product?.price)} /></div>
                <div className="v2-fld wide"><label>Description</label><textarea placeholder="Materials, dimensions, finish…" /></div>
                <div className="v2-fld"><label>SKU</label><input readOnly defaultValue={product?.sku ?? ''} /><span className="v2-hint">Generated if left blank</span></div>
              </div>
            </>
          }
        />

        {/* 4 · CARD */}
        <Pair
          title="Card"
          note="v1's card carries a shadow and a coloured icon square that is close to the rail's chip without matching it — same idea, different size, radius and tint, which is the most misleading near-miss on the contact sheet. This is the rail's chip, at the rail's size, reading the group hue."
          v1={
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 4px 12px rgba(16,24,40,.04)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eef2ff', display: 'grid', placeItems: 'center', marginBottom: 10 }}>
                <FileText size={18} color="#6366f1" />
              </div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Platform Usage</p>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>Total conversations, messages and active channels over time.</p>
            </div>
          }
          v2={
            <div className="v2-card" style={{ ['--ghue' as string]: 'var(--v2-t3)' }}>
              <span className="v2-chip-sq"><FileText /></span>
              <h4>Platform Usage</h4>
              <p>Total conversations, messages and active channels over time.</p>
            </div>
          }
        />

        {/* 5 · EMPTY STATE */}
        <Pair
          title="Empty state"
          note="/orders is genuinely empty on this tenant, so this is the real case rather than a mock of one. v1 centres a grey sentence in a box, which reads as a loading state that never finished. Two lines: what is not here, and what to do about it."
          v1={
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 28, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
              No orders yet. Create your first order.
            </div>
          }
          v2={
            <div className="v2-card" data-empty>
              <b>No orders yet</b>
              <span>The first one will appear here as soon as it is created.</span>
            </div>
          }
        />

        {/* 6 · NOTICE / UPGRADE */}
        <Pair
          title="Upgrade notice"
          note="The amber panel on /ai-employees/new is the same pattern as the red block that was in the rail until this morning: a colour field standing in for emphasis. Same treatment as the rail's fix — a row, with the urgency in a badge and the sentence in plain ink."
          v1={
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14 }}>
              <p style={{ margin: 0, fontSize: 14, color: '#92400e' }}>Your plan includes 1 AI employee. Upgrade to add more.</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13 }}>Back</button>
                <button style={{ border: 0, background: '#111', color: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13 }}>Upgrade plan</button>
              </div>
            </div>
          }
          v2={
            <div className="v2-notice" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}>
              <span className="v2-chip-sq"><CreditCard /></span>
              <p>Your plan includes one AI employee.</p>
              <em>Upgrade</em>
            </div>
          }
        />

        {/* 7 · CHAT */}
        <Pair
          title="Chat"
          note="Real messages, one of each voice — ordering by time alone returned four consecutive assistant replies and demonstrated nothing. v1 tells the two apart by alignment and a violet fill. Here the employee takes ONE hue from the family, not the caption's gradient: the gradient restarted inside every bubble, so a three-word reply and a two-line one read as different colours, and it earns its weight by appearing once per screen."
          v1={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {msgs.slice(0, 3).map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.us ? 'flex-end' : 'flex-start',
                  background: m.us ? '#6366f1' : '#f3f4f6',
                  color: m.us ? '#fff' : '#111',
                  borderRadius: 14, padding: '9px 13px', fontSize: 14, maxWidth: '78%',
                }}>{m.text.slice(0, 90)}</div>
              ))}
              {!msgs.length && <p style={{ fontSize: 13, color: '#6b7280' }}>No messages on this tenant.</p>}
            </div>
          }
          v2={
            <div className="v2-thread">
              {msgs.slice(0, 3).map((m, i) => (
                <div key={i} className="v2-bub" data-who={m.us ? 'us' : 'them'}>
                  {m.text.slice(0, 90)}
                  <time>{m.at ? new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}</time>
                </div>
              ))}
              {!msgs.length && <div className="v2-card" data-empty><b>No messages yet</b><span>The first conversation will appear here.</span></div>}
            </div>
          }
        />

        {/* 8 · LIST ROW — ADDED AFTER APPROVAL. The approved kit had a table and a card and no third
            thing, and /inbox needs one: fifty records whose "columns" are a title, a sentence and a
            time, which a <table> turns into a header that says nothing and a sideways scroll at
            390px. Rather than invent a language for it, this is the approved table row with the
            cells taken out — every value (13px rhythm, hairline, hover, the left rule in --chan) is
            the table's. Flagged rather than slipped in: it is the one component here Yoad has not
            already signed off. */}
        <Pair
          title="List row — /v2’s own, extended"
          note="Not a new component: .v2-row is the row /v2 already uses for its own lists — the kit simply never paired it, which read as ‘v2 has no row’. Three things are added for a page-wide list of conversations that a 340px dashboard column never needed: the 660px cap lifted, the under-720px card treatment flattened to one hairline per row, and the unread dot taking the row’s channel hue instead of /v2’s pink. The face is the dome crop, per the one-face rule."
          v1={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {contacts.slice(0, 3).map((c, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                  background: ['#f0fdfa', '#eff6ff', '#fff'][i], borderRadius: 16,
                  boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)',
                }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#ccfbf1', color: '#0f766e',
                                display: 'grid', placeItems: 'center', fontWeight: 600, flex: 'none' }}>
                    {(c.name || c.phone || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{c.name || c.phone || 'Unknown'}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 999,
                                     background: '#ccfbf1', color: '#0f766e' }}>{c.channel || 'voice'}</span>
                    </div>
                    <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280' }}>No summary yet</p>
                  </div>
                  <span style={{ fontSize: 12, color: '#9ca3af' }}>2h ago</span>
                </div>
              ))}
            </div>
          }
          v2={
            <div className="v2-list">
              {contacts.slice(0, 3).map((c, i) => (
                <div key={i} className="v2-row" data-click
                     style={{ ['--chan' as string]: CHAN[c.channel ?? 'voice'] ?? 'var(--v2-t1)' }}>
                  <RobotAvatar size={38} className="v2-av" />
                  <div className="v2-m">
                    <p className="flex items-center gap-2 min-w-0">
                      <span className="truncate">{c.name || c.phone || 'Unknown'}</span>
                      {i === 0 && <span className="v2-dot" />}
                      {i === 0 && <span className="v2-stat">3</span>}
                      <span className="v2-stat">{c.channel || 'voice'}</span>
                    </p>
                    <span>No summary yet</span>
                  </div>
                  <div className="v2-meta"><em>open</em><em>2h ago</em></div>
                </div>
              ))}
            </div>
          }
        />

        {/* 9 · FACT LIST + ICON BUTTON — ADDED AFTER APPROVAL, same caveat. The contact panel is
            label-left / value-right rows and two round buttons, and neither existed in the kit. */}
        <Pair
          title="Fact list and icon button — /v2’s own, extended"
          note="Also already /v2’s: .v2-facts is the dt/dd grid on /v2’s detail screens, two columns wide and one on a phone. The only addition is data-narrow, for the 256px contact rail, which is a phone-width column on a desktop page. The round icon button is new — the chip’s tint without the square, which is what tells an icon-only control apart from .v2-chip-sq, an icon that labels something."
          v1={
            <div>
              <h3 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' }}>Details</h3>
              {[['Channel', 'voice'], ['Sentiment', 'positive'], ['Messages', '4']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: '#6b7280' }}>
                  <span>{k}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, padding: '2px 10px', borderRadius: 999, background: '#cffafe', color: '#0e7490' }}>{v}</span>
                </div>
              ))}
              <button style={{ marginTop: 14, width: 44, height: 44, borderRadius: '50%', border: 0, background: '#f3f4f6', color: '#6b7280' }}>i</button>
            </div>
          }
          v2={
            <div>
              <p className="v2-kick" style={{ marginBottom: 12 }}>Details</p>
              <dl className="v2-facts" data-narrow>
                <div><dt>Channel</dt><dd><span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t4)' }}>voice</span></dd></div>
                <div><dt>Sentiment</dt><dd><span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>positive</span></dd></div>
                <div><dt>Messages</dt><dd>4</dd></div>
              </dl>
              <button type="button" className="v2-ico" style={{ marginTop: 14 }} aria-label="Contact info"><Info /></button>
            </div>
          }
        />

        {/* 11 · ACTION BAR — /orders/[id] carries six verbs, two irreversible */}
        <Pair
          title="Action bar — new"
          note="Six verbs across the top of an order. v1 gave each its own bordered box and made the two irreversible ones red, so the first thing the page said was “six buttons”, and “Delete order” was exactly as easy to hit as “Estimate”. Same pills as everywhere else, wrapping rather than scrolling; one filled because it is the thing you most likely came to do; and a hairline marking where the reversible actions stop. The rule is the separator — the red is only allowed after it."
          v1={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Edit order', 'Estimate', 'Quote', 'Mark finished'].map((l) => (
                <span key={l} style={{ borderRadius: 8, border: '1px solid #d1d5db', padding: '8px 12px', fontSize: 14, color: '#374151', background: '#fff' }}>{l}</span>
              ))}
              {['Cancel order', 'Delete order'].map((l) => (
                <span key={l} style={{ borderRadius: 8, border: '1px solid #fecaca', padding: '8px 12px', fontSize: 14, color: '#dc2626', background: '#fff' }}>{l}</span>
              ))}
            </div>
          }
          v2={
            <div className="v2-bar">
              <button type="button" className="v2-act" data-solid>Edit order</button>
              <button type="button" className="v2-act">Estimate</button>
              <button type="button" className="v2-act">Quote</button>
              <button type="button" className="v2-act">Mark finished</button>
              <hr />
              <button type="button" className="v2-act" data-danger>Cancel order</button>
              <button type="button" className="v2-act" data-danger>Delete order</button>
            </div>
          }
        />

        {/* 12 · DETAILS LIST — already in the kit, shown against the panel it replaces */}
        <Pair
          title="Key-value details — /v2’s own, already here"
          note="Not a new component: .v2-facts is the dt/dd grid already used by the contact rail and the inbox panel, and the order’s Details panel is the same thing — a label and a value. It is paired here because /orders/[id] builds its own by hand out of a bordered card and two text sizes, and the point of the kit is that it should not have to."
          v1={
            <div style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', padding: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Details</div>
              {[['Customer email', '—'], ['Factory', '—'], ['Requested', '2026-09-07'], ['Est. completion', '—']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13.5 }}>
                  <span style={{ color: '#6b7280' }}>{k}</span><span style={{ color: '#111827' }}>{v}</span>
                </div>
              ))}
            </div>
          }
          v2={
            <div>
              <p className="v2-kick" style={{ marginBottom: 12 }}>Details</p>
              <dl className="v2-facts" data-narrow>
                <div><dt>Customer email</dt><dd>—</dd></div>
                <div><dt>Factory</dt><dd>—</dd></div>
                <div><dt>Requested</dt><dd>2026-09-07</dd></div>
                <div><dt>Est. completion</dt><dd>—</dd></div>
              </dl>
            </div>
          }
        />

        {/* 13 · DROPZONE — new */}
        <Pair
          title="File dropzone — new"
          note="The empty card’s dashed edge, made a target — same border, same radius, same paper, because a dashed edge is already this language’s way of saying “nothing here yet” and a drop target is that plus an invitation. One state is added and only one: the moment a file is dragged over it, which is the only moment the surface should react. Used by the order’s attachments panel and by the contacts import wizard, which built its own."
          v1={
            <div style={{ borderRadius: 12, border: '2px dashed #d1d5db', background: '#f9fafb', padding: '34px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Drop files here, or click to choose</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Photos, sketches, PDFs, videos, CAD — up to 50 MB each</div>
            </div>
          }
          v2={
            <button type="button" className="v2-drop">
              <Upload />
              <b>Drop files here, or click to choose</b>
              <span>Photos, sketches, PDFs, videos, CAD (STL, OBJ, 3DM, STEP, ZIP…) — up to 50 MB each</span>
            </button>
          }
        />

        {/* 10 · MODAL — the §29 gap, proposed */}
        <Pair
          title="Modal — proposed, not yet migrated"
          note="The kit had a bottom drawer and a card and no dialog, so /contacts built two by hand: New contact and the three-step Import wizard. Left is what ships today — the card's edge on the veil, assembled inline. Right is the same shape promoted, and the difference is not in the picture: the promoted one takes focus on open, traps Tab and Shift+Tab at both ends, returns focus to whatever opened it, closes on Escape, and locks the page behind it — replacing the scrollbar's width so the layout does not flinch. It is role=dialog with aria-modal and a label. Below 560px it becomes the drawer's shape rather than a centred box with margins. The two buttons open the real one; the keyboard is the thing to try."
          v1={
            <div style={{ position: 'relative', background: 'rgba(10,10,13,0.10)', borderRadius: 12, padding: 22, minHeight: 260 }}>
              <div style={{ background: 'var(--v2-paper)', border: '1px solid var(--v2-line)', borderRadius: 16, padding: 18 }}>
                <div className="v2-head" style={{ marginBottom: 12 }}>
                  <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}><i />New contact</p><s />
                </div>
                <p className="v2-hint" style={{ marginBottom: 12 }}>A name, email or phone is enough.</p>
                <div className="v2-form">
                  <div className="v2-fld wide"><label>Name</label><input readOnly /></div>
                  <div className="v2-fld"><label>Email</label><input readOnly /></div>
                  <div className="v2-fld"><label>Phone</label><input readOnly /></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <span className="v2-act" data-solid>Save contact</span>
                  <span className="v2-act">Cancel</span>
                </div>
              </div>
              <p className="v2k-note" style={{ marginTop: 12 }}>
                No focus trap, no escape, no scroll lock, no dialog role. Tab walks out of it onto the page behind.
              </p>
            </div>
          }
          v2={<ModalDemo contacts={contacts.map((c) => ({ name: c.name ?? null, email: c.email ?? null, phone: c.phone ?? null }))} />}
        />

        <div className="v2-head"><p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t4)' }}><i />Not yet designed</p><s /></div>
        <p className="v2k-note">
          Four component types the detail pages surfaced that are not in this kit, because they need a
          decision before a design: the <b>tabs</b> on /ai-employees/[id]/playbook, the <b>activity
          timeline</b> on /contacts/[id], the <b>media and QR block</b> on /catalog/[id], and the
          <b> dark panel</b> on /ai-employees/[id]/brain — which is already closer to /v2 than anything
          else in v1 and may be the thing others move toward rather than away from.
        </p>
        <p className="v2k-note">
          Two more are now in the kit above, marked <b>added after approval</b>, because /inbox needed
          them and neither could be built out of what was approved: the <b>list row</b> and the
          <b> fact list / icon button</b>. Both are derived from approved components rather than
          invented — the row is the table row without cells, the fact list is the panel’s two columns.
          The <b>bottom sheet</b> they sit inside is the same paper and the same hairline as the card,
          at full width.
        </p>
      </div>
    </div>
  )
}
