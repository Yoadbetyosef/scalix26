import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Whitespace in an env value is invisible in a dashboard and fatal in an OAuth request. These pin both
// failure modes: the loud one (Intuit rejects the redirect_uri) and the silent one (a stray newline
// downgrades production to sandbox, and everything "works" into a test company).

const ENV_KEYS = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REDIRECT_URI', 'QBO_ENVIRONMENT'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => { for (const k of ENV_KEYS) saved[k] = process.env[k] })
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  vi.resetModules()
})

// config.ts reads process.env at module load, so each case needs a fresh import.
async function loadConfig(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const k of ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(values)) process.env[k] = v
  vi.resetModules()
  return import('./config')
}

describe('QBO config', () => {
  it('trims a trailing newline off the redirect URI', async () => {
    const { QBO } = await loadConfig({ QBO_REDIRECT_URI: 'https://app.scalix26.com/api/quickbooks/callback\n' })
    expect(QBO.redirectUri).toBe('https://app.scalix26.com/api/quickbooks/callback')
  })

  it('trims surrounding whitespace off the client id and secret', async () => {
    const { QBO } = await loadConfig({ QBO_CLIENT_ID: '  abc123 ', QBO_CLIENT_SECRET: '\tsecret\n' })
    expect(QBO.clientId).toBe('abc123')
    expect(QBO.clientSecret).toBe('secret')
  })

  it('still reads production when the value carries whitespace', async () => {
    const { QBO } = await loadConfig({ QBO_ENVIRONMENT: 'production\n' })
    expect(QBO.environment).toBe('production')
  })

  it('falls back to sandbox for anything unrecognised — the safe direction', async () => {
    expect((await loadConfig({ QBO_ENVIRONMENT: 'prod' })).QBO.environment).toBe('sandbox')
    expect((await loadConfig({})).QBO.environment).toBe('sandbox')
  })

  it('reports not-configured when a value is only whitespace', async () => {
    const { qboConfigured } = await loadConfig({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b', QBO_REDIRECT_URI: '   ' })
    expect(qboConfigured()).toBe(false)
  })

  it('reports configured when all three are present', async () => {
    const { qboConfigured } = await loadConfig({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b', QBO_REDIRECT_URI: 'https://x/y' })
    expect(qboConfigured()).toBe(true)
  })
})
