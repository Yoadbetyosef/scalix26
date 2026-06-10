import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, Phone, Mail, MessageCircle, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate, isSocialChannel } from '@/lib/utils'

export default async function ContactsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const serviceSupabase = await createServiceClient()
  const { data: tenant } = await serviceSupabase.from('tenants').select('id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!tenant) redirect('/auth/signup')

  const { data: contacts } = await supabase
    .from('contacts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('last_interaction', { ascending: false })
    .limit(100)

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Contacts</h1>
          <p className="text-sm text-gray-500 mt-0.5">{contacts?.length || 0} total contacts</p>
        </div>
      </div>

      {!contacts?.length ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400">
          <Users className="w-12 h-12 mb-3" />
          <p className="text-sm">No contacts yet</p>
          <p className="text-xs text-gray-400 mt-1 text-center">Contacts are created automatically when customers reach out</p>
        </div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="md:hidden space-y-2">
            {contacts.map((contact) => (
              <Link key={contact.id} href={`/contacts/${contact.id}`} className="tap-target block bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-[#4ecdc4]/10 flex items-center justify-center text-[#4ecdc4] text-sm font-medium flex-shrink-0">
                    {contact.name?.[0] || contact.phone?.[0] || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{contact.name || 'Unknown'}</p>
                    {contact.channel && (
                      <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'} className="mt-0.5">
                        {contact.channel}
                      </Badge>
                    )}
                  </div>
                  {contact.last_interaction && (
                    <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(contact.last_interaction)}</p>
                  )}
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </div>
                <div className="space-y-1.5 text-sm text-gray-600">
                  {contact.phone && (
                    <div className="flex items-center gap-2">
                      {isSocialChannel(contact.channel)
                        ? <MessageCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        : <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                      <span className="break-all">{contact.phone}</span>
                    </div>
                  )}
                  {contact.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="truncate">{contact.email}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span>{contact.total_conversations} conversation{contact.total_conversations !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Phone</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Channel</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden lg:table-cell">Conversations</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide hidden xl:table-cell">Last Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <Link href={`/contacts/${contact.id}`} className="flex items-center gap-3 group">
                        <div className="w-8 h-8 rounded-full bg-[#4ecdc4]/10 flex items-center justify-center text-[#4ecdc4] text-sm font-medium">
                          {contact.name?.[0] || contact.phone?.[0] || '?'}
                        </div>
                        <span className="text-sm font-medium text-gray-900 group-hover:text-[#4ecdc4] transition-colors">
                          {contact.name || 'Unknown'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      {contact.phone ? (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600">
                          {isSocialChannel(contact.channel)
                            ? <MessageCircle className="w-3.5 h-3.5 text-gray-400" />
                            : <Phone className="w-3.5 h-3.5 text-gray-400" />}
                          <span className="break-all">{contact.phone}</span>
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      {contact.email ? (
                        <div className="flex items-center gap-1.5 text-sm text-gray-600">
                          <Mail className="w-3.5 h-3.5 text-gray-400" />
                          {contact.email}
                        </div>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      {contact.channel ? (
                        <Badge variant={contact.channel as 'sms' | 'voice' | 'whatsapp' | 'instagram' | 'facebook'}>
                          {contact.channel}
                        </Badge>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        <MessageCircle className="w-3.5 h-3.5 text-gray-400" />
                        {contact.total_conversations}
                      </div>
                    </td>
                    <td className="px-6 py-4 hidden xl:table-cell text-sm text-gray-500">
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
