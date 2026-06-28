import { type ContextSource, str } from '../types'

export const knowledgeSource: ContextSource = {
  id: 'search_knowledge',
  description: "Search this business's own knowledge base — website knowledge, services, pricing, hours, uploaded facts, and internal notes the AI uses to answer customers. Use for questions about how THIS business operates.",
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look up (services, pricing, hours, policies, etc.).' } },
    required: ['query'],
  },
  async run(ctx, args) {
    const query = str(args.query)
    if (!query) return 'What should I look up in the knowledge base?'
    const like = `%${query}%`
    const { data } = await ctx.db
      .from('knowledge_base')
      .select('title, content, source')
      .eq('tenant_id', ctx.tenantId)
      .or(`title.ilike.${like},content.ilike.${like}`)
      .limit(8)
    if (!data?.length) return `Nothing in the knowledge base about "${query}".`
    const lines = data.map((k) => `- ${k.title || '(untitled)'}: ${(k.content || '').slice(0, 240)}`)
    return `Knowledge base on "${query}":\n${lines.join('\n')}`
  },
}
