// Write WHAT HAPPENED for the conversations that predate it.
//
// The recap is written at completion (lib/conversations/recap.ts), so without this every
// conversation already in the table stays blank forever and the section never appears on a screen
// somebody opens today. Roughly a tenth of a cent each on claude-haiku-4-5.
//
// ── recap_at IS ONLY SET WHERE THE CONVERSATION IS ACTUALLY OVER ────────────────────────────────
//
// A call is over whatever its status column says — the older voice rows were written 'open' by a
// path that predates the current route, which is why this does NOT filter on status: doing so would
// skip 43 of the 77 calls, exactly the ones the screen is emptiest for.
//
// But a text thread marked 'open' may genuinely still be running. Those get a recap of where they
// stand AND keep `recap_at` null, so the completion path rewrites it properly when they are finally
// resolved. A second write on ~29 threads costs about three cents; a permanently stale account of a
// live conversation costs the owner's trust in the screen.
//
// Selection is on `recap IS NULL`, not on recap_at, so re-running does not repeat work.
//
//   node_modules/.bin/tsx scripts/backfill-conversation-recaps.ts [--tenant <id>] [--limit N] [--commit]
import { readFileSync } from 'node:fs'
import { MAX_MESSAGES, MIN_MESSAGES, RECAP_MAX_TOKENS, recapPrompt } from '../lib/conversations/recap'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const AI = env.ANTHROPIC_API_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }

const MODEL = 'claude-haiku-4-5'
/** lib/cost/rates.ts, $ per million. Reported so the run states what it spent. */
const RATE_IN = 1.0
const RATE_OUT = 5.0

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const tenant = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : null
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 500

const rest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.status === 204 ? (null as T) : ((await res.json()) as T)
}

interface Conv { id: string; tenant_id: string; channel: string; status: string }
interface Msg { role: string; content: string }

async function main() {
  const filter = [
    'recap=is.null',
    tenant ? `tenant_id=eq.${tenant}` : '',
    `select=id,tenant_id,channel,status`,
    `order=created_at.asc`,
    `limit=${limit}`,
  ].filter(Boolean).join('&')

  const convs = await rest<Conv[]>(`conversations?${filter}`)
  console.log(`${convs.length} conversation(s) without a recap${tenant ? ` for tenant ${tenant}` : ''}`)
  if (!commit) console.log('DRY RUN — nothing will be written. Add --commit.\n')

  let written = 0, skipped = 0, failed = 0, inTok = 0, outTok = 0

  for (const c of convs) {
    const msgs = await rest<Msg[]>(
      `messages?conversation_id=eq.${c.id}&select=role,content&order=timestamp.asc&limit=${MAX_MESSAGES}`,
    )
    if (msgs.length < MIN_MESSAGES) {
      skipped++
      console.log(`  · ${c.id.slice(0, 8)} ${c.channel.padEnd(9)} skipped — ${msgs.length} message(s)`)
      continue
    }

    const transcript = msgs.map((m) => `${m.role}: ${m.content}`).join('\n')
    if (!commit) {
      console.log(`  · ${c.id.slice(0, 8)} ${c.channel.padEnd(9)} would recap — ${msgs.length} messages, ${transcript.length} chars`)
      continue
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': AI, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: RECAP_MAX_TOKENS,
          messages: [{ role: 'user', content: recapPrompt(transcript) }],
        }),
      })
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
      const body = await res.json() as { content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number } }
      const text = body.content.find((b) => b.type === 'text')?.text?.trim() ?? ''
      if (!text) throw new Error('empty response')
      inTok += body.usage.input_tokens
      outTok += body.usage.output_tokens

      // A call is over whether or not somebody marked it so; a text thread still 'open' may not be.
      const complete = c.channel === 'voice' || c.status === 'resolved' || c.status === 'closed'
      await rest(`conversations?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ recap: text, ...(complete ? { recap_at: new Date().toISOString() } : {}) }),
      })
      written++
      console.log(`  ✓ ${c.id.slice(0, 8)} ${c.channel.padEnd(9)} ${complete ? 'final ' : 'open  '} ${text.slice(0, 84)}…`)
    } catch (err) {
      failed++
      console.error(`  ✗ ${c.id.slice(0, 8)} ${c.channel.padEnd(9)} ${err instanceof Error ? err.message : err}`)
    }
  }

  const cost = (inTok / 1e6) * RATE_IN + (outTok / 1e6) * RATE_OUT
  console.log(`\n${written} written · ${skipped} too short · ${failed} failed`)
  if (commit) console.log(`${inTok} in / ${outTok} out tokens on ${MODEL} = $${cost.toFixed(4)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
