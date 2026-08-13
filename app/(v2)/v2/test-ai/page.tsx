import { listPageContext } from '../list-page'
import { TestAiClient } from './client'

// Gated on `ai_voice`, exactly as app/test-ai/layout.tsx gates it.
export const dynamic = 'force-dynamic'

export default async function V2TestAi() {
  await listPageContext('ai_voice')
  return <TestAiClient />
}
