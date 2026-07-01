// Read-only demo: runs the REAL Business Brain deterministic pipeline (patterns →
// understanding → recommendations) against a real tenant's data. No DB writes.
//   npx tsc -p tsconfig.brain-demo.json && node .brain-demo-build/scripts/brain-demo.js
import fs from 'fs'
import { detectPatterns } from '../lib/brain/patterns'
import { deriveUnderstanding } from '../lib/brain/understanding'
import { deriveRecommendations } from '../lib/brain/recommendations'
import { DNA_STRANDS, DNA_LABEL, type BrainData, type BrainMsg, type BrainConv } from '../lib/brain/types'

const env = fs.readFileSync('.env.local', 'utf8')
const get = (k: string) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : '' }
const SUPA = get('NEXT_PUBLIC_SUPABASE_URL'); const KEY = get('SUPABASE_SERVICE_ROLE_KEY') || get('SUPABASE_SERVICE_KEY')
const rest = (p: string) => fetch(SUPA + '/rest/v1/' + p, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }).then((r) => r.json())

;(async () => {
  const tenants = await rest('tenants?select=id,business_name,stripe_connect_status')
  const tenant = tenants.find((t: { business_name: string }) => /smith hvac/i.test(t.business_name || '')) || tenants[0]
  const agents = await rest(`ai_employees?select=id,name&tenant_id=eq.${tenant.id}`)
  const agent = agents[0]
  console.log(`\n=== Business Brain — ${tenant.business_name} (agent ${agent?.name}) ===\n`)

  const conversations: BrainConv[] = await rest(`conversations?select=id,channel,human_takeover,sentiment,status,created_at,contact_id&tenant_id=eq.${tenant.id}&order=created_at.desc&limit=2000`)
  const rawMsgs = await rest(`messages?select=conversation_id,role,content,timestamp&tenant_id=eq.${tenant.id}&order=timestamp.asc&limit=20000`)
  const messagesByConv = new Map<string, BrainMsg[]>()
  for (const m of rawMsgs) { const a = messagesByConv.get(m.conversation_id) || []; a.push({ role: m.role, content: String(m.content || ''), timestamp: m.timestamp }); messagesByConv.set(m.conversation_id, a) }
  const [leads, appointments, payments, paymentRequests] = await Promise.all([
    rest(`leads?select=status,source,created_at,responded_at&tenant_id=eq.${tenant.id}&limit=2000`),
    rest(`appointments?select=status,channel,created_at,contact_id&tenant_id=eq.${tenant.id}&limit=2000`),
    rest(`payments?select=status,amount,product_name,created_at&tenant_id=eq.${tenant.id}&limit=2000`).catch(() => []),
    rest(`payment_requests?select=status,amount,created_at,conversation_id&tenant_id=eq.${tenant.id}&limit=2000`).catch(() => []),
  ])

  const data: BrainData = { now: Date.now(), tenant, conversations, messagesByConv, leads, appointments, payments, paymentRequests }
  console.log(`scanned: ${conversations.length} conversations · ${rawMsgs.length} messages · ${leads.length} leads · ${appointments.length} appointments · ${payments.length} payments\n`)

  const patterns = detectPatterns(data)
  const understandings = deriveUnderstanding(patterns)
  const recs = deriveRecommendations(understandings)

  console.log(`PATTERNS (${patterns.length}):`)
  for (const p of patterns) console.log(`  • [${p.category}] ${p.title}: ${p.description}  (evidence ${p.evidence_count}, ~${p.weeks_observed.toFixed(1)}w, consistency ${(p.consistency * 100) | 0}%)`)

  console.log(`\nBUSINESS DNA:`)
  for (const strand of DNA_STRANDS) {
    const us = understandings.filter((u) => u.dna_strand === strand)
    const strength = us.length ? Math.round(us.reduce((a, u) => a + u.business_confidence, 0) / us.length) : 0
    console.log(`  ${DNA_LABEL[strand].padEnd(20)} ${String(strength).padStart(3)}%  (${us.length} understanding${us.length === 1 ? '' : 's'})`)
  }

  console.log(`\nUNDERSTANDING (${understandings.length}):`)
  for (const u of understandings) console.log(`  • [${DNA_LABEL[u.dna_strand]}] ${u.statement}\n      Business Confidence ${u.business_confidence}% · ${u.evidence_strength} · ${u.evidence_summary}`)

  console.log(`\nRECOMMENDATIONS (${recs.length}):`)
  for (const r of recs) console.log(`  ▸ ${r.title} (${r.business_confidence}%)\n      Why: ${r.why}\n      How: ${r.how}\n      If ignored: ${r.if_ignored}`)
  console.log(`\n=== counts: ${patterns.length} patterns · ${understandings.length} understandings · ${recs.length} recommendations ===\n`)
})()
