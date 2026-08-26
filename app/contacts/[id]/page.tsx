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

        {/* Conversation history — the kit's list row, the same component /inbox uses, because these
            are the same records seen from the other side. */}
        <div className="lg:col-span-2">
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
  )
}
