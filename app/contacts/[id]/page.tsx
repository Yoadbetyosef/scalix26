import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ContactEdit } from '@/components/contacts/contact-edit'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Globe, Calendar, Clock } from 'lucide-react'
import { Chip } from '@/components/inbox/conversation-contact-panel'
import { channelHue } from '@/app/(v2)/v2/channels'
import { formatDate, formatDateTime, contactIdentifier } from '@/lib/utils'
import { contactDisplayOrIdentifier, contactInitial } from '@/lib/contacts/names'
import { readCustomerHistory } from '@/lib/customer/history'
import { getTenantEnabledModules } from '@/lib/tenant'
import { stageHue } from '@/lib/orders/stage-colors'
import { STATUS_GROUP_LABELS } from '@/lib/orders/stages'

// Status wears the same chip as the channel, in its own hue — identical to /inbox/[id], because a
// conversation's status means the same thing on whichever screen it is listed.
const STATUS_HUE: Record<string, string> = {
  open: 'var(--v2-t1)', resolved: 'var(--v2-t2)', closed: 'var(--v2-mute)',
}

// One fact row: an icon that says what kind of thing this is, and the value. Icons earn their place
// here where they do not in a table — a phone number, an address and a language look alike as text.
function Fact({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm" style={{ color: 'var(--v2-ink)' }}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--v2-mute)' }} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export default async function ContactProfilePage({ params }: { params: Promise<{ id: string }> }) {
  // `?from=leads` used to send you back to the Leads tab. The tab is gone, and so is the only thing
  // that produced the parameter, so the searchParams prop went with it. Back is contacts.
  const backHref = '/contacts'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant);
  // both queries filter by the server-validated tenantId.
  const service = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  const { id } = await params

  const { data: contact } = await service
    .from('contacts')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!contact) notFound()

  const { data: conversations } = await service
    .from('conversations')
    .select('id, channel, status, summary, created_at, updated_at')
    .eq('contact_id', id)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(50)

  // Everything else that is about this person — orders, estimates (taken or not), payments and
  // appointments. Only when the tenant has Orders at all; a tenant without it sees the page it had.
  const modules = await getTenantEnabledModules()
  const history = modules.includes('orders')
    ? await readCustomerHistory(tenantId, { id: contact.id, email: contact.email, phone: contact.phone })
    : null
  const money = (c: number, cur: string) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: (cur || 'usd').toUpperCase(), maximumFractionDigits: 0 }).format(c / 100)

  const ident = contactIdentifier(contact.channel, contact.phone)
  const IdentIcon = ident?.isPhone ? Phone : MessageCircle

  // Same rule as the list (CT2), from the same helper: identify them by whatever we actually have
  // rather than by "Unknown". For a B2B customer the company leads and the person follows it — see
  // lib/contacts/names.ts for why the em dash and why that order.
  const title = contactDisplayOrIdentifier(contact)

  const chanHue = channelHue(contact.channel)

  return (
    // `v2` for the tokens, `v2-embedded` so Tailwind's spacing utilities still do the layout here.
    <div className="v2 v2-embedded p-4 sm:p-6 max-w-4xl">
      {/* Header. No 30px page title over a rail that already says Contacts — the person's name IS
          the title, at the size a name needs, and the round back button is the kit's icon button. */}
      <div className="v2-head" style={{ alignItems: 'center' }}>
        <Link href={backHref} className="v2-ico tap-target" aria-label="Back"><ArrowLeft /></Link>
        <span
          className="v2-chip-sq"
          style={{ ['--ghue' as string]: chanHue, width: 42, height: 42, borderRadius: 13, fontFamily: 'var(--v2-mono)', fontSize: 16, textTransform: 'uppercase', color: chanHue, flex: 'none' }}
        >
          {contactInitial(contact)}
        </span>
        <div className="min-w-0" style={{ flex: 1 }}>
          {/* THE HEADING SPLITS WHAT THE LIST JOINED. On a row you get one line and the composed
              name is the only way to say both; here there is room, so the company is the title and
              the person is who you actually speak to — which is the thing you came to check. */}
          <h1 className="text-lg font-semibold tracking-tight truncate" style={{ color: 'var(--v2-ink)' }}>
            {contact.company_name || title}
          </h1>
          <p className="v2-kick" style={{ marginTop: 2 }}>
            {[contact.company_name && contact.name, contact.channel].filter(Boolean).join(' · ') || contact.channel}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact details */}
        <div className="lg:col-span-1 space-y-6">
          <div>
            <div className="v2-head" style={{ marginBottom: 12 }}>
              <p className="v2-kick">Contact details</p>
              <s />
              <ContactEdit
                contactId={contact.id}
                initial={{
                  company_name: contact.company_name ?? null,
                  first_name: contact.first_name ?? null, last_name: contact.last_name ?? null,
                  name: contact.name ?? null, email: contact.email ?? null, phone: contact.phone ?? null,
                  address: contact.address ?? null, currency: contact.currency ?? null, notes: contact.notes ?? null,
                }}
              />
            </div>
            <div className="space-y-3">
              {ident && (
                <Fact icon={IdentIcon}>
                  {ident.isPhone
                    ? <a href={`tel:${ident.value}`} className="font-medium hover:underline break-all" style={{ color: 'var(--v2-ink)' }}>{ident.value}</a>
                    : <span className="break-all">{ident.value}</span>}
                  <p className="v2-kick" style={{ marginTop: 2 }}>{ident.label}</p>
                </Fact>
              )}
              {contact.email && <Fact icon={Mail}><span className="break-all">{contact.email}</span></Fact>}
              {contact.address && <Fact icon={MapPin}>{contact.address}</Fact>}
              {contact.language && <Fact icon={Globe}><span className="uppercase">{contact.language}</span></Fact>}
              <Fact icon={MessageCircle}>{contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}</Fact>
              {contact.last_interaction && <Fact icon={Clock}>Last contact {formatDate(contact.last_interaction)}</Fact>}
              <Fact icon={Calendar}>Added {formatDate(contact.created_at)}</Fact>
            </div>
          </div>

          {/* The notes card renders whether or not there ARE notes — an invisible empty card was
              also an uneditable one, which is the fault the comment here used to describe. */}
          <div>
            <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick">Notes</p><s /></div>
            {contact.notes
              ? <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--v2-ink)' }}>{contact.notes}</p>
              : <div className="v2-card" data-empty><b>No notes yet</b><span>Use Edit above to add some.</span></div>}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          {/* ── ORDERS, ESTIMATES AND EVERYTHING BOUGHT OR QUOTED ─────────────────────────────────
              The permanent record. A closed-no-sale estimate sits here next to the finished ring,
              because "we quoted you a 1.2ct oval in March" is the sentence a returning customer
              needs to hear. Matched by the link on the order AND by the email/phone typed on it —
              see lib/customer/history.ts. */}
          {history && (
            <div>
              <div className="v2-head" style={{ marginBottom: 12 }}>
                <p className="v2-kick">Orders &amp; estimates · {history.totals.orders}</p>
                <s />
                {history.totals.spentCents > 0 && (
                  <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>Paid {money(history.totals.spentCents, history.orders[0]?.currency ?? 'usd')}</span>
                )}
                <Link href={`/orders/new?contact=${contact.id}`} className="v2-act">New order</Link>
              </div>
              {history.orders.length === 0 ? (
                <div className="v2-card" data-empty>
                  <b>No orders or estimates yet</b>
                  <span>Every estimate, quote, order and invoice for this person will be listed here — including the ones that did not go ahead.</span>
                </div>
              ) : (
                // ── FOUR PILES, IN THE ORDER A JEWELLER ASKS ABOUT THEM ─────────────────────────
                // What is live now; what was done; what was quoted and not taken (kept on purpose —
                // "we quoted you a 1.2ct oval in March" is the sentence a returning customer needs);
                // and what was cancelled. Each row says what the piece was, where it stands, which
                // documents were actually sent, and opens the order.
                (['active', 'closed', 'no_sale', 'cancelled'] as const).map((g) => {
                  const rows = history.orders.filter((o) => o.group === g)
                  if (rows.length === 0) return null
                  const heading = g === 'active' ? 'Active orders & estimates' : g === 'closed' ? 'Closed orders' : g === 'no_sale' ? 'Estimates not taken (Closed – No Sale)' : 'Cancelled'
                  const docName = (t: string) => t === 'estimate' ? 'Estimate' : t === 'quote' ? 'Quote' : t === 'invoice' ? 'Invoice' : t
                  return (
                    <div key={g} style={{ marginBottom: 18 }}>
                      <p className="v2-kick" style={{ marginBottom: 8 }}>{heading} · {rows.length}</p>
                      <div className="v2-list">
                        {rows.map((o) => (
                          <Link key={o.id} href={`/orders/${o.id}`} className="v2-row tap-target" data-click style={{ ['--chan' as string]: stageHue(o.stage) }}>
                            <div className="v2-m">
                              <p className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="truncate">{o.summary ?? 'Order'}</span>
                                {o.kindLabel && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t1)' }}>{o.kindLabel}</span>}
                                <span className="v2-stat">{o.group === 'active' ? o.stageLabel : STATUS_GROUP_LABELS[o.group]}</span>
                                {o.invoicedAt && <span className="v2-stat" style={{ ['--chan' as string]: 'var(--v2-t2)' }}>Invoiced</span>}
                              </p>
                              <span style={{ fontSize: 12 }}>
                                <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11.5 }}>{o.orderNumber}</span>
                                {o.group !== 'active' ? ` · ${o.stageLabel}` : ''}
                                {o.sent.length > 0 ? ` · ${o.sent.map((d) => `${docName(d.docType)} sent ${formatDate(d.at)}`).join(', ')}` : ''}
                                {o.via !== 'contact' ? ` · found by the ${o.via} on the order` : ''}
                              </span>
                            </div>
                            <div className="v2-meta">
                              <em style={{ fontVariantNumeric: 'tabular-nums' }}>{money(o.subtotalCents, o.currency)}</em>
                              <em>{formatDate(o.createdAt)}</em>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {history && history.payments.length > 0 && (
            <div>
              <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick">Payments · {history.payments.length}</p><s /></div>
              <div className="v2-list">
                {history.payments.map((p) => (
                  <Link key={p.id} href={`/orders/${p.orderId}`} className="v2-row tap-target" data-click>
                    <div className="v2-m">
                      <p>{p.kind === 'deposit' ? 'Deposit' : p.kind === 'refund' ? 'Refund' : 'Payment'}{p.method ? ` · ${({ card: 'credit card', cheque: 'cheque', cash: 'cash', wire: 'wire transfer', etransfer: 'e-transfer', transfer: 'transfer', zelle: 'Zelle', other: 'other' } as Record<string, string>)[p.method] ?? p.method}` : ''}</p>
                      <span style={{ fontFamily: 'var(--v2-mono)', fontSize: 11.5 }}>{p.orderNumber}</span>
                    </div>
                    <div className="v2-meta">
                      <em style={{ fontVariantNumeric: 'tabular-nums' }}>{p.amountCents < 0 ? '−' : ''}{money(Math.abs(p.amountCents), p.currency)}</em>
                      <em>{p.paidOn}</em>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {history && history.memos.length > 0 && (
            <div>
              <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick">Memos · {history.memos.length}</p><s /></div>
              <div className="v2-list">
                {history.memos.map((m) => (
                  <Link key={m.id} href={`/orders/memos/${m.id}`} className="v2-row tap-target" data-click style={{ ['--chan' as string]: m.settled ? 'var(--v2-mute)' : 'var(--v2-t3)' }}>
                    <div className="v2-m">
                      <p className="flex items-center gap-2 flex-wrap min-w-0"><span className="truncate">{m.itemDescription}</span><span className="v2-stat">{m.statusLabel}</span></p>
                      <span>{m.movedOn}{m.dueOn && !m.settled ? ` · follow up ${m.dueOn}` : ''}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {history && history.appointments.length > 0 && (
            <div>
              <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick">Appointments · {history.appointments.length}</p><s /></div>
              <div className="v2-list">
                {history.appointments.map((a) => (
                  <div key={a.id} className="v2-row">
                    <div className="v2-m">
                      <p>{a.serviceType ?? 'Appointment'}{a.status ? <span className="v2-stat" style={{ marginLeft: 8 }}>{a.status}</span> : null}</p>
                      <span>{a.slotDate}{a.slotTime ? ` · ${a.slotTime}` : ''}{a.meetingKind ? ` · ${a.meetingKind.replace('_', ' ')}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Conversation history — the kit's list row, the same component /inbox uses, because these
              are the same records seen from the other side. */}
          <div>
          <div className="v2-head" style={{ marginBottom: 12 }}><p className="v2-kick">Conversation history</p><s /></div>
          {!conversations?.length ? (
            <div className="v2-card" data-empty>
              <b>No conversations yet</b>
              <span>When this person calls, texts, emails or messages, the conversation appears here.</span>
            </div>
          ) : (
            <div className="v2-list">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/inbox/${conv.id}`}
                  className="v2-row tap-target"
                  data-click
                  style={{ ['--chan' as string]: channelHue(conv.channel) }}
                >
                  <div className="v2-m">
                    <p className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="v2-stat">{conv.channel}</span>
                      <Chip value={conv.status} hue={STATUS_HUE[conv.status] ?? 'var(--v2-ink-45)'} />
                    </p>
                    <span className="line-clamp-2">{conv.summary || 'No summary available'}</span>
                  </div>
                  <div className="v2-meta"><em>{formatDateTime(conv.updated_at)}</em></div>
                </Link>
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}
