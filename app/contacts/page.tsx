import { createClient } from '@/lib/supabase/server'
import { getActiveTenantId } from '@/lib/workspace'
import { listContactsPage } from '@/lib/contacts/page-read'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Phone, MessageCircle, ChevronRight, ChevronLeft, Search } from 'lucide-react'
import { ContactActions } from '@/components/contacts/new-contact'
import { formatDate, isSocialChannel } from '@/lib/utils'
import { channelHue } from '@/app/(v2)/v2/channels'

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

  // Operator-safe by construction: listContactsPage opens its own admin client and takes the
  // server-validated tenantId as its sole scope. (A `createAdminClient()` binding sat here unused
  // before this migration — it went with the import rather than staying to fail lint.)
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
    // `v2` carries the tokens every promoted class reads; `v2-embedded` undoes the 100dvh and hidden
    // overflow that belong to a route owning the viewport, and puts Tailwind's spacing utilities back
    // in charge inside this subtree.
    <div className="v2 v2-embedded p-4 sm:p-6">
      {/* No page title. The rail says Contacts; the micro-label carries the count, which is the one
          thing the rail cannot say, and the rule runs to the actions. */}
      <div className="v2-head">
        <p className="v2-kick" style={{ ['--ghue' as string]: 'var(--v2-t1)' }}>
          <i />
          {q
            ? `${total} ${total === 1 ? 'match' : 'matches'} for “${q}”`
            : `Address book · ${total}`}
        </p>
        <s />
        <ContactActions />
      </div>

      {/* Search — a rule, not a box. Same GET form, so a search is still a real URL you can go back to. */}
      <form className="v2-fld mb-5" style={{ position: 'relative' }}>
        <label htmlFor="contacts-q">Search</label>
        <input
          id="contacts-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Name, email, phone or address…"
          style={{ paddingRight: 24 }}
        />
        <Search className="w-4 h-4" style={{ position: 'absolute', right: 0, bottom: 10, color: 'var(--v2-ink-45)' }} />
      </form>

      {!contacts.length ? (
        q ? (
          <div className="v2-card" data-empty>
            <b>No contacts match that search</b>
            <span>Nothing here matches “{q}”. Try part of a name, an email address, a phone number, or a city.</span>
          </div>
        ) : (
          <div className="v2-card" data-empty>
            <b>Your address book builds itself</b>
            <span>Every person your AI talks to — across calls, texts, email and social — is saved here automatically, with their full history. Use New contact to add someone by hand, or Import file to bring in a whole list at once.</span>
          </div>
        )
      ) : (
        <>
          {/* TWO RENDERINGS, ONE ROW SET — and unlike /inbox's two, this is deliberate.
              A contact genuinely has columns: name, phone, email, channel, conversations, last
              contact. On a desktop those line up and the table earns them, which is the case the
              kit's .v2-tbl exists for. At 390px six columns are a sideways scrollbar, so the phone
              gets .v2-row, the kit's list row, exactly as /inbox does.
              What made /inbox's pair wrong was that the two had drifted into showing DIFFERENT
              content — a friendly title on one, a raw initial on the other. Here every value both
              render comes from the same `contact` object and the same two helpers above, so the
              phone shows a strict subset of the desktop columns and there is nothing to drift. */}
          <div className="v2-list md:hidden -mx-4">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="v2-row tap-target"
                data-click
                style={{ ['--chan' as string]: channelHue(contact.channel) }}
              >
                {/* The initial, in the kit's own chip square rather than v1's tinted circle. A
                    contact is a customer, not the employee — the one-face rule is about Rudi, and
                    putting his dome on a customer row would say the opposite of what it means. */}
                <span className="v2-chip-sq" style={{ ['--ghue' as string]: channelHue(contact.channel), fontFamily: 'var(--v2-mono)', fontSize: 13, textTransform: 'uppercase', color: channelHue(contact.channel) }}>
                  {displayInitial(contact)}
                </span>
                <div className="v2-m">
                  <p className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{displayTitle(contact)}</span>
                    {contact.channel && <span className="v2-stat">{contact.channel}</span>}
                  </p>
                  {contact.total_conversations > 0 && (
                    <span>
                      {contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}
                      {contact.last_interaction ? ` · last ${formatDate(contact.last_interaction)}` : ''}
                    </span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-ink-45)' }} />
              </Link>
            ))}
          </div>

          {/* The kit's table: mono micro-label headers, a row that lights from the left in its own
              channel hue, and the channel as a chip in that hue rather than v1's coloured badge. */}
          <div className="hidden md:block">
            <table className="v2-tbl">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th className="max-lg:hidden">Email</th>
                  <th>Channel</th>
                  <th className="max-lg:hidden">Conversations</th>
                  <th className="max-xl:hidden">Last contact</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} style={{ ['--chan' as string]: channelHue(contact.channel) }}>
                    <td>
                      <Link href={`/contacts/${contact.id}`} className="block truncate" style={{ color: 'var(--v2-ink)', fontWeight: 500 }}>
                        {displayTitle(contact)}
                      </Link>
                    </td>
                    <td>
                      {contact.phone ? (
                        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--v2-ink-72)' }}>
                          {isSocialChannel(contact.channel)
                            ? <MessageCircle className="w-3.5 h-3.5" style={{ color: 'var(--v2-ink-45)' }} />
                            : <Phone className="w-3.5 h-3.5" style={{ color: 'var(--v2-ink-45)' }} />}
                          <span className="break-all">{contact.phone}</span>
                        </span>
                      ) : <span style={{ color: 'var(--v2-ink-45)' }}>—</span>}
                    </td>
                    <td className="max-lg:hidden" style={{ color: 'var(--v2-ink-72)' }}>
                      {contact.email || <span style={{ color: 'var(--v2-ink-45)' }}>—</span>}
                    </td>
                    <td>
                      {contact.channel
                        ? <span className="v2-stat">{contact.channel}</span>
                        : <span style={{ color: 'var(--v2-ink-45)' }}>—</span>}
                    </td>
                    <td className="max-lg:hidden" style={{ color: 'var(--v2-ink-72)' }}>{contact.total_conversations}</td>
                    <td className="max-xl:hidden" style={{ color: 'var(--v2-ink-72)' }}>
                      {contact.last_interaction ? formatDate(contact.last_interaction) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paging. Hidden when the whole book fits on one page — most businesses never see it.
              The two ends are the same pill as every other verb, disabled rather than swapped for a
              grey span, so the control does not change shape when it becomes unavailable. */}
          {lastPage > 1 && (
            <div className="flex items-center justify-between gap-3 mt-5">
              <p className="v2-kick">Showing {firstShown}–{lastShown} of {total}</p>
              <div className="flex items-center gap-2">
                {page > 1
                  ? <Link href={pageHref(page - 1)} className="v2-act tap-target"><ChevronLeft className="w-3.5 h-3.5" /> Previous</Link>
                  : <button className="v2-act" disabled><ChevronLeft className="w-3.5 h-3.5" /> Previous</button>}
                <span className="v2-kick">Page {page} of {lastPage}</span>
                {page < lastPage
                  ? <Link href={pageHref(page + 1)} className="v2-act tap-target">Next <ChevronRight className="w-3.5 h-3.5" /></Link>
                  : <button className="v2-act" disabled>Next <ChevronRight className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
