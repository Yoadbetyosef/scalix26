import { googleProvider } from './google'
import type { MailProvider, MailProviderName } from './types'

// Provider registry. Add Microsoft 365 later by creating lib/mailbox/microsoft.ts
// (same MailProvider interface) and registering it here.
const PROVIDERS: Partial<Record<MailProviderName, MailProvider>> = {
  google: googleProvider,
  // microsoft: microsoftProvider,
}

export function getProvider(name: MailProviderName): MailProvider {
  const p = PROVIDERS[name]
  if (!p) throw new Error(`mail provider not implemented: ${name}`)
  return p
}

export type { MailProvider, MailProviderName } from './types'
