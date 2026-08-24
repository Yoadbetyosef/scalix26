import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ContactEdit } from '@/components/contacts/contact-edit'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Globe, Calendar, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatDateTime, contactIdentifier } from '@/lib/utils'

export default async function ContactProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  // `?from=leads` used to send you back to the Leads tab; the tab is gone, and so is the only
  // thing that produced the parameter. Back is contacts.
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

  // Same rule as the list (CT2): identify them by whatever we actually have rather than by "Unknown".
  const title = contact.name || contact.email || contact.phone || 'Unknown contact'

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Link href={backHref} className="tap-target -ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-sunken flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-sunken to-hairline ring-1 ring-hairline flex items-center justify-center text-ink text-lg font-light uppercase flex-shrink-0">
          {title[0] || '?'}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink truncate">{title}</h1>
          {contact.channel && (
            <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'} className="mt-0.5">
              {contact.channel}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact details */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border border-hairline shadow-e1 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-xs font-semibold text-subtle uppercase tracking-wide">Contact Details</h2>
              <ContactEdit
                contactId={contact.id}
                initial={{
                  name: contact.name ?? null, email: contact.email ?? null, phone: contact.phone ?? null,
                  address: contact.address ?? null, currency: contact.currency ?? null, notes: contact.notes ?? null,
                }}
              />
            </div>
            <div className="space-y-3 text-sm">
              {ident && (
                <div className="flex items-start gap-3">
                  <IdentIcon className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {ident.isPhone ? (
                      <a href={`tel:${ident.value}`} className="text-ink font-medium hover:underline break-all">{ident.value}</a>
                    ) : (
                      <span className="text-ink break-all">{ident.value}</span>
                    )}
                    <p className="text-xs text-muted">{ident.label}</p>
                  </div>
                </div>
              )}
              {contact.email && (
                <div className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <span className="text-ink break-all">{contact.email}</span>
                </div>
              )}
              {contact.address && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <span className="text-ink">{contact.address}</span>
                </div>
              )}
              {contact.language && (
                <div className="flex items-start gap-3">
                  <Globe className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <span className="text-ink uppercase">{contact.language}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <MessageCircle className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                <span className="text-ink">{contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}</span>
              </div>
              {contact.last_interaction && (
                <div className="flex items-start gap-3">
                  <Clock className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                  <span className="text-ink">Last contact {formatDate(contact.last_interaction)}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-muted flex-shrink-0 mt-0.5" />
                <span className="text-ink">Added {formatDate(contact.created_at)}</span>
              </div>
            </div>
          </div>

          {/* The notes card used to render only when there WERE notes, so an empty one was invisible
              as well as uneditable — the same fault as the fields above, one card out. */}
          <div className="bg-white rounded-2xl border border-hairline shadow-e1 p-5">
            <h2 className="text-xs font-semibold text-subtle uppercase tracking-wide mb-2">Notes</h2>
            {contact.notes
              ? <p className="text-sm text-ink whitespace-pre-wrap">{contact.notes}</p>
              : <p className="text-sm text-muted">No notes yet. Use Edit above to add some.</p>}
          </div>
        </div>

        {/* Conversation history */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-2xl border border-hairline shadow-e1 overflow-hidden">
            <div className="px-5 py-4 border-b border-hairline">
              <h2 className="text-xs font-semibold text-subtle uppercase tracking-wide">Conversation History</h2>
            </div>
            {!conversations?.length ? (
              <div className="px-5 py-10 text-center text-sm text-muted">No conversations yet</div>
            ) : (
              <div className="divide-y divide-hairline">
                {conversations.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/inbox/${conv.id}`}
                    className="tap-target block px-5 py-4 hover:bg-sunken transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge variant={conv.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>{conv.channel}</Badge>
                      <Badge variant={conv.status as 'open' | 'resolved' | 'closed'}>{conv.status}</Badge>
                      <span className="text-xs text-muted ml-auto flex-shrink-0">{formatDateTime(conv.updated_at)}</span>
                    </div>
                    <p className="text-sm text-subtle line-clamp-2">
                      {conv.summary || 'No summary available'}
                    </p>
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
