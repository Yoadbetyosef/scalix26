import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { listContactsPage } from '@/lib/contacts/page-read'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Phone, Mail, MessageCircle, ChevronRight, ChevronLeft, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ContactActions } from '@/components/contacts/new-contact'
import { formatDate, isSocialChannel } from '@/lib/utils'

// Soft channel tint for contact avatars — a quiet touch of life, the channel color
// recognizable at a glance without shouting.
const CHANNEL_TINT: Record<string, string> = {
  voice: 'bg-cyan-100 text-cyan-700', sms: 'bg-emerald-100 text-emerald-700',
  email: 'bg-violet-100 text-violet-700', whatsapp: 'bg-green-100 text-green-700',
  facebook: 'bg-blue-100 text-blue-700', instagram: 'bg-pink-100 text-pink-700',
}

const PAGE_SIZE = 50

interface ContactRow {
  id: string; name: string | null; email: string | null; phone: string | null
  channel: string | null; total_conversations: number; last_interaction: string | null
}

// CT2: a contact the AI created from one inbound email or call has nothing but that address or
// number, and calling them "Unknown" hides the one thing we DO know about them. Whatever identifies
// them is the title instead, and drives the avatar letter. Display-only — no data changes.
const displayTitle = (c: ContactRow): string => c.name || c.email || c.phone || 'Unknown'
const displayInitial = (c: ContactRow): string => displayTitle(c)[0] || '?'

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Admin client (operator-safe; createServiceClient would RLS-scope to the partner's own tenant) +
  // server-validated tenantId as the sole scope.
  const serviceSupabase = createAdminClient()
  const tenantId = await getActiveTenantId()
  if (!tenantId) redirect('/auth/signup')

  const params = await searchParams
  const q = (params.q ?? '').trim()
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  // Moved to lib/contacts/page-read.ts so /v2's contacts list reads the SAME window onto the address
  // book. Same slice, same ordering, same search — see that file's header.
  const { contacts, total } = await listContactsPage(tenantId, { q, page, pageSize: PAGE_SIZE })
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : offset + 1
  const lastShown = offset + contacts.length
  const pageHref = (n: number) => `/contacts?${new URLSearchParams({ ...(q ? { q } : {}), ...(n > 1 ? { page: String(n) } : {}) })}`

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-ink">Contacts</h1>
          <p className="text-sm text-muted mt-1">
            {q
              ? `${total} ${total === 1 ? 'match' : 'matches'} for “${q}”`
              : `${total} total contact${total === 1 ? '' : 's'}`}
          </p>
        </div>
        <ContactActions />
      </div>

      {/* Search — a plain GET form, so a search is a real URL the browser can go back to. */}
      <form className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by name, email, phone, or address..."
          className="pl-10 h-11 w-full rounded-xl border border-hairline bg-white text-sm text-ink placeholder:text-muted outline-none transition-shadow duration-200 focus:border-ink/15 focus:shadow-[0_0_0_4px_rgba(26,31,54,0.04)]"
        />
      </form>

      {!contacts.length ? (
        q ? (
          <EmptyState icon={Search} title="No contacts match that search">
            Nothing here matches <strong>{q}</strong>. Try part of a name, an email address, a phone number, or a city.
          </EmptyState>
        ) : (
          <EmptyState icon={Users} title="Your address book builds itself">
            Every person your AI talks to — across calls, texts, email, and social — is saved here automatically, with their full history.
            Use <strong>New contact</strong> to add someone by hand, or <strong>Import file</strong> to bring in a whole list at once.
          </EmptyState>
        )
      ) : (
        <>
          {/* Mobile compact list rows */}
          <div className="md:hidden -mx-4 border-t border-hairline">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="tap-target flex items-center gap-3 min-h-[64px] px-4 border-b border-hairline"
              >
                <div className={`w-[38px] h-[38px] rounded-full ${CHANNEL_TINT[contact.channel || ''] || 'bg-sunken text-subtle'} flex items-center justify-center text-sm font-medium flex-shrink-0 uppercase`}>
                  {displayInitial(contact)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{displayTitle(contact)}</p>
                  {contact.total_conversations > 0 && (
                    <p className="text-xs text-muted truncate mt-0.5">
                      {contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted flex-shrink-0" />
              </Link>
            ))}
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
                        <div className={`w-8 h-8 rounded-full ${CHANNEL_TINT[contact.channel || ''] || 'bg-sunken text-subtle'} flex items-center justify-center text-sm font-medium uppercase flex-shrink-0`}>
                          {displayInitial(contact)}
                        </div>
                        <span className="text-sm font-medium text-ink group-hover:text-accent-strong transition-colors">
                          {displayTitle(contact)}
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

          {/* Paging. Hidden when the whole book fits on one page — most businesses never see it. */}
          {lastPage > 1 && (
            <div className="flex items-center justify-between gap-3 mt-4">
              <p className="text-xs text-muted">
                Showing {firstShown}–{lastShown} of {total}
              </p>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className="tap-target inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-hairline bg-white text-sm text-ink hover:bg-sunken transition-colors">
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-hairline text-sm text-muted">
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </span>
                )}
                <span className="text-xs text-muted tabular-nums px-1">Page {page} of {lastPage}</span>
                {page < lastPage ? (
                  <Link href={pageHref(page + 1)} className="tap-target inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-hairline bg-white text-sm text-ink hover:bg-sunken transition-colors">
                    Next <ChevronRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 h-10 px-3.5 rounded-xl border border-hairline text-sm text-muted">
                    Next <ChevronRight className="w-4 h-4" />
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
