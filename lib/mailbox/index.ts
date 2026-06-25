import { googleProvider } from './google'
import { microsoftProvider } from './microsoft'
import type { MailProvider, MailProviderName } from './types'

// Provider registry. Each provider implements the same MailProvider interface; the
// account layer + poll loop dispatch via getProvider(row.provider).
const PROVIDERS: Partial<Record<MailProviderName, MailProvider>> = {
  google: googleProvider,
  microsoft: microsoftProvider,
}

export function getProvider(name: MailProviderName): MailProvider {
  const p = PROVIDERS[name]
  if (!p) throw new Error(`mail provider not implemented: ${name}`)
  return p
}

export type { MailProvider, MailProviderName } from './types'
