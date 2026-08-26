import { type ContextSource, str } from '../types'

export const contactsSource: ContextSource = {
  id: 'lookup_contact',
  description: "Look up a specific customer/contact in this business and their history (channel, total conversations, last seen, notes). Use when the owner names a person or phone number.",
  input_schema: {
    type: 'object',
    properties: { name_or_phone: { type: 'string', description: 'A name, phone number, or email to find.' } },
    required: ['name_or_phone'],
  },
  async run(ctx, args) {
    const term = str(args.name_or_phone)
    if (!term) return 'Give me a name, phone, or email to look up.'
    const like = `%${term}%`
    const { data } = await ctx.db
      .from('contacts')
      .select('id, name, phone, email, channel, total_conversations, last_interaction, notes')
      .eq('tenant_id', ctx.tenantId)
      .or(`name.ilike.${like},company_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .order('last_interaction', { ascending: false })
      .limit(5)
    if (!data?.length) return `No contact matches "${term}".`
    const lines = await Promise.all(
      data.map(async (c) => {
        const { data: recent } = await ctx.db
          .from('conversations')
          .select('channel, status, summary, updated_at')
          .eq('tenant_id', ctx.tenantId)
          .eq('contact_id', c.id)
          .order('updated_at', { ascending: false })
          .limit(2)
        const hist = (recent || []).map((r) => `    · [${r.channel}/${r.status}] ${r.summary || '(no summary)'}`).join('\n')
        const last = c.last_interaction ? new Date(c.last_interaction).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'never'
        return `- ${c.name || 'Unknown'} (${c.phone || c.email || '—'}) · ${c.total_conversations || 0} conversations · last ${last}${c.notes ? ` · note: ${c.notes}` : ''}${hist ? `\n${hist}` : ''}`
      }),
    )
    return `Contacts matching "${term}":\n${lines.join('\n')}`
  },
}
