import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Phone, Mail, MessageCircle, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, isSocialChannel } from '@/lib/utils'

// Soft channel tint for contact avatars — a quiet touch of life, the channel color
// recognizable at a glance without shouting.
const CHANNEL_TINT: Record<string, string> = {
  voice: 'bg-cyan-100 text-cyan-700', sms: 'bg-emerald-100 text-emerald-700',
  email: 'bg-violet-100 text-violet-700', whatsapp: 'bg-green-100 text-green-700',
  facebook: 'bg-blue-100 text-blue-700', instagram: 'bg-pink-100 text-pink-700',
}

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant) +
  // server-validated tenantId as the sole scope.
  const serviceSupabase = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  const { data: contacts } = await serviceSupabase
    .from('contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('last_interaction', { ascending: false })
    .limit(100)

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Contacts</h1>
          <p className="text-sm text-muted mt-1">{contacts?.length || 0} total contacts</p>
        </div>
      </div>

      {!contacts?.length ? (
        <EmptyState icon={Users} title="Your address book builds itself">
          Every person your AI talks to — across calls, texts, email, and social — is saved here automatically, with their full history.
        </EmptyState>
      ) : (
        <>
          {/* Mobile compact list rows */}
          <div className="md:hidden -mx-4 border-t border-hairline">
            {contacts.map((contact) => {
              // CT2: email becomes the title when name is Unknown (display-only, no data change).
              const hasName = Boolean(contact.name)
              const emailPrefix = contact.email ? contact.email.split('@')[0] : ''
              const title = hasName ? contact.name : (contact.email || contact.phone || 'Unknown')
              // Initials: name → first letter; else email prefix; else phone; else '?'.
              const initial = (hasName ? contact.name?.[0] : (emailPrefix?.[0] || contact.phone?.[0])) || '?'
              return (
                <Link
                  key={contact.id}
                  href={`/contacts/${contact.id}`}
                  className="tap-target flex items-center gap-3 min-h-[64px] px-4 border-b border-hairline"
                >
                  <div className={`w-[38px] h-[38px] rounded-full ${CHANNEL_TINT[contact.channel || ''] || 'bg-sunken text-subtle'} flex items-center justify-center text-sm font-medium flex-shrink-0 uppercase`}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{title}</p>
                    {contact.total_conversations > 0 && (
                      <p className="text-xs text-muted truncate mt-0.5">
                        {contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
                </Link>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-hairline shadow-e1 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide">Phone</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide hidden lg:table-cell">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide">Channel</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide hidden lg:table-cell">Conversations</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-subtle uppercase tracking-wide hidden xl:table-cell">Last Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-sunken transition-colors">
                    <td className="px-6 py-4">
                      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 group">
                        <div className={`w-8 h-8 rounded-full ${CHANNEL_TINT[contact.channel || ''] || 'bg-sunken text-subtle'} flex items-center justify-center text-sm font-medium`}>
                          {contact.name?.[0] || contact.phone?.[0] || '?'}
                        </div>
                        <span className="text-sm font-medium text-ink group-hover:text-accent-strong transition-colors">
                          {contact.name || 'Unknown'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {contact.phone ? (
                        <div className="flex items-center gap-1.5 text-sm text-subtle">
                          {isSocialChannel(contact.channel)
                            ? <MessageCircle className="w-3.5 h-3.5 text-muted" />
                            : <Phone className="w-3.5 h-3.5 text-muted" />}
                          <span className="break-all">{contact.phone}</span>
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      {contact.email ? (
                        <div className="flex items-center gap-1.5 text-sm text-subtle">
                          <Mail className="w-3.5 h-3.5 text-muted" />
                          {contact.email}
                        </div>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      {contact.channel ? (
                        <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                          {contact.channel}
                        </Badge>
                      ) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5 text-sm text-subtle">
                        <MessageCircle className="w-3.5 h-3.5 text-muted" />
                        {contact.total_conversations}
                      </div>
                    </td>
                    <td className="px-6 py-4 hidden xl:table-cell text-sm text-subtle">
                      {contact.last_interaction ? formatDate(contact.last_interaction) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
