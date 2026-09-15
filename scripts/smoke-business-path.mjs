// The whole jewellery business path, driven through the DEPLOYED app's own HTTP API as a signed-in
// owner, with a logged-out client for the customer's side.
//
//   node scripts/smoke-business-path.mjs <deployed-base-url>
//
// Signs in as the PROBE account (its own demo tenant — never TG's data), then runs:
//   customer → jewellery lines (bracelet, ring, chain, loose stone) → save/reload/edit → estimate →
//   public link (logged out: video + certificate + login wall on the internal URL) → closed no sale →
//   reopen → in process → payments (deposit, partial, final, refund; verified after re-read) →
//   board moves forward/back/non-adjacent → invoice before completion → closed order (out of Open,
//   in history, reopen) → vendor quotation → purchase → memo out/in → consignment → repair →
//   appraisal → the customer's history page.
//
// Every row it makes is marked SMOKE- and deleted at the end, pass or fail. Steps that depend on a
// migration part not yet applied are reported as PENDING(part N), not as failures, so the script
// is useful before and after the migration is run.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, KEY = env.SUPABASE_SERVICE_ROLE_KEY
const APP = (process.argv[2] || '').replace(/\/$/, '')
if (!APP) { console.error('Usage: node scripts/smoke-business-path.mjs <deployed-base-url>'); process.exit(1) }
const ref = new URL(SB).hostname.split('.')[0]

let pass = 0, fail = 0, pending = 0
const ok = (d, c, detail) => { console.log(`  ${c ? 'PASS' : 'FAIL'}: ${d}${!c && detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}` : ''}`); if (c) pass++; else fail++ }
const pend = (d, part) => { console.log(`  PENDING(part ${part}): ${d}`); pending++ }
const info = (d) => console.log(`  info: ${d}`)
const SH = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const srest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: SH, ...o })

// ── Sign in, and become the cookie the app reads ────────────────────────────────────────────────
const login = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email: env.PROBE_EMAIL, password: env.PROBE_PASSWORD }) })).json()
if (!login.access_token) { console.error('probe login failed', login); process.exit(1) }
// @supabase/ssr: `sb-<ref>-auth-token` = "base64-" + base64url(JSON session), chunked at ~3180 chars.
const raw = 'base64-' + Buffer.from(JSON.stringify(login)).toString('base64url')
const chunks = raw.match(/.{1,3180}/g)
const cookie = chunks.length === 1 ? `sb-${ref}-auth-token=${raw}` : chunks.map((c, i) => `sb-${ref}-auth-token.${i}=${c}`).join('; ')
const tenantId = (await (await srest(`tenants?select=id&user_id=eq.${login.user.id}`)).json())[0]?.id
info(`signed in as the probe account; tenant ${tenantId?.slice(0, 8)}… (never TG)`)

const api = async (path, init = {}) => {
  const r = await fetch(`${APP}${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) }, redirect: 'manual' })
  let body = null
  try { body = await r.json() } catch { body = null }
  return { status: r.status, body }
}
const page = async (path, withCookie = true) => {
  const r = await fetch(`${APP}${path}`, { headers: withCookie ? { cookie } : {}, redirect: 'manual' })
  return { status: r.status, html: await r.text(), location: r.headers.get('location') }
}
const upload = async (orderId, name, type, bytes) => {
  const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), name)
  const r = await fetch(`${APP}/api/orders/${orderId}/attachments`, { method: 'POST', headers: { cookie }, body: fd })
  return { status: r.status, body: await r.json().catch(() => null) }
}
// A capability-gated refusal: 409 (checked up front) or 400 (found at write time), with the user-safe
// wording and never a database detail.
const isPending = (res, part) => (res.status === 409 || res.status === 400) && /not enabled on this account yet|not available on this account yet/.test(res.body?.error ?? '') && !/add_tg_production|migration|column|constraint/i.test(res.body?.error ?? '') ? part : null

const TAG = `SMOKE-${Date.now().toString(36).toUpperCase()}`
const made = { contacts: [], orders: [], products: [], memos: [], suppliers: [] }
const PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF')
// A minimal MP4 'ftyp' box — enough for the upload allowlist (extension) and the customer route (302).
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isom')])

let contactId, orderId, shareUrl
try {
  // ── Customer ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nCustomer')
  const c1 = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ first_name: 'Smoke', last_name: TAG, email: `${TAG.toLowerCase()}@example.test`, phone: '604 555 0199' }) })
  contactId = c1.body?.contact?.id
  ok(`create customer (${c1.status})`, c1.status === 200 && !!contactId)
  if (contactId) made.contacts.push(contactId)
  const c2 = await api(`/api/contacts/${contactId}`, { method: 'PATCH', body: JSON.stringify({ company_name: `${TAG} Yachts Ltd`, address: '622 Granville St' }) })
  ok(`edit customer — company + contact (${c2.status})`, c2.status === 200)
  const found = await api(`/api/contacts/search?q=${encodeURIComponent(TAG.toLowerCase())}`)
  ok('existing customer lookup finds them by email fragment', (found.body?.contacts ?? []).some((c) => c.id === contactId))
  const dupe = await api('/api/contacts', { method: 'POST', body: JSON.stringify({ name: 'Different Name', email: `${TAG.toLowerCase()}@example.test` }) })
  ok(`no duplicate creation on the same email (${dupe.status}, duplicateOf set)`, dupe.status === 409 && dupe.body?.duplicateOf?.id === contactId)

  // ── Jewellery ────────────────────────────────────────────────────────────────────────────────
  console.log('\nJewellery')
  const lines = [
    { productType: 'Bracelet', productName: `${TAG} tennis bracelet`, quantity: 1, unitPriceCents: 485000, internalCostCents: 210000, stoneType: 'Diamond', stoneOrigin: 'Natural', stoneQuality: 'VS1', stoneColor: 'G', centerStoneShape: 'Round', centerStoneCarat: 5.25, sideStoneShapes: ['Round', 'Baguette'], metalKarat: '14K White Gold', measurements: "7''", certificateLab: 'GIA', customSpec: 'Safety catch' },
    { productType: 'Ring', productName: `${TAG} solitaire`, quantity: 1, unitPriceCents: 1200000, stoneType: 'Diamond', stoneQuality: 'VVS2', stoneColor: 'F', centerStoneShape: 'Oval', centerStoneCarat: 1.52, sideStoneShapes: ['Round'], sideStoneCaratTotal: 0.4, metalKarat: 'Platinum', ringSize: '6.5', bandWidthMm: 2.1 },
    { productType: 'Chain', productName: `${TAG} rope chain`, quantity: 1, unitPriceCents: 89000, metalKarat: '18K Yellow Gold', measurements: "20''" },
    { productType: 'Loose stone', productName: `${TAG} loose oval`, quantity: 1, unitPriceCents: 640000, stoneType: 'Diamond', stoneOrigin: 'Lab Grown', stoneQuality: 'VS2', stoneColor: 'D', centerStoneShape: 'Oval', centerStoneCarat: 2.01, measurements: '9.1 x 6.8 x 4.2', certificateLab: 'IGI' },
  ]
  const o1 = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contactId, customerName: `Smoke ${TAG}`, customerCompany: `${TAG} Yachts Ltd`, customerEmail: `${TAG.toLowerCase()}@example.test`, currency: 'cad', taxChoiceId: 'BC:combined', lineItems: lines, orderKind: 'custom', kindDetails: {} }) })
  orderId = o1.body?.order?.id
  ok(`create order with four pieces (${o1.status})`, o1.status === 200 && !!orderId)
  if (orderId) made.orders.push(orderId)
  const g1 = await api(`/api/orders/${orderId}`)
  const li = g1.body?.order?.lineItems ?? []
  const br = li.find((l) => l.productType === 'Bracelet'), rg = li.find((l) => l.productType === 'Ring'), ch = li.find((l) => l.productType === 'Chain'), ls = li.find((l) => l.productType === 'Loose stone')
  ok('reload: four lines came back', li.length === 4)
  ok('bracelet: quality, price, cost, carat, shapes, metal, length, cert all persisted', br?.stoneQuality === 'VS1' && br?.unitPriceCents === 485000 && br?.internalCostCents === 210000 && br?.centerStoneCarat === 5.25 && JSON.stringify(br?.sideStoneShapes) === '["Round","Baguette"]' && br?.metalKarat === '14K White Gold' && br?.measurements === "7''" && br?.certificateLab === 'GIA')
  ok('ring: size, band width, side carat persisted', rg?.ringSize === '6.5' && rg?.bandWidthMm === 2.1 && rg?.sideStoneCaratTotal === 0.4)
  ok('chain and loose stone persisted with their own fields', ch?.measurements === "20''" && ls?.stoneOrigin === 'Lab Grown' && ls?.measurements === '9.1 x 6.8 x 4.2')
  ok('order linked to the customer, tax snapshot BC 12%', g1.body?.order?.contactId === contactId && g1.body?.order?.taxRatePercent === 12)
  // Edit again: change the bracelet's quality and price, keep everything else; reload; verify.
  const edited = li.map((l) => ({ ...l, id: undefined, orderId: undefined, lineTotalCents: undefined, displayOrder: undefined, ...(l.productType === 'Bracelet' ? { stoneQuality: 'VVS1', unitPriceCents: 499000 } : {}) }))
  const e1 = await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ contactId, customerName: `Smoke ${TAG}`, customerEmail: `${TAG.toLowerCase()}@example.test`, currency: 'cad', taxChoiceId: 'BC:combined', lineItems: edited }) })
  const g2 = await api(`/api/orders/${orderId}`)
  const br2 = (g2.body?.order?.lineItems ?? []).find((l) => l.productType === 'Bracelet')
  ok(`edit again → reload: quality VVS1, price 4990, other fields intact (${e1.status})`, e1.status === 200 && br2?.stoneQuality === 'VVS1' && br2?.unitPriceCents === 499000 && br2?.centerStoneCarat === 5.25 && br2?.metalKarat === '14K White Gold' && g2.body?.order?.lineItems?.length === 4)
  ok('subtotal re-priced after the edit', g2.body?.order?.subtotalCents === 499000 + 1200000 + 89000 + 640000)

  // Save stress: every piece type, several saves, unrelated edits, add/remove/reorder — nothing typed
  // on one line may vanish because another line or another field was touched.
  const strip = (l) => { const c = { ...l }; delete c.id; delete c.orderId; delete c.lineTotalCents; delete c.displayOrder; return c }
  const moreLines = [
    { productType: 'Earrings', productName: `${TAG} diamond studs`, quantity: 1, unitPriceCents: 199000, stoneType: 'Diamond', stoneQuality: 'VS1', centerStoneShape: 'Round', centerStoneCarat: 1.0, metalKarat: '14K White Gold', measurements: '6mm' },
    { productType: 'Necklace', productName: `${TAG} pendant necklace`, quantity: 1, unitPriceCents: 150000, stoneType: 'Sapphire', centerStoneShape: 'Oval', centerStoneCarat: 0.8, metalKarat: '18K Yellow Gold', measurements: "18''" },
    { productType: 'Watch', productName: `${TAG} Datejust`, quantity: 1, unitPriceCents: 800000, metalKarat: 'Stainless steel', measurements: 'Ref 126234 · 36mm', customSpec: 'Box and papers' },
    { productType: 'Other', productName: `${TAG} brooch`, quantity: 2, unitPriceCents: 40000, metalKarat: 'Sterling Silver', description: 'Vintage, marcasite' },
  ]
  const cur = () => api(`/api/orders/${orderId}`).then((r) => r.body?.order)
  let o = await cur()
  const save = async (lineItems, extra = {}) => api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ lineItems, ...extra }) })
  // add four more (eight in all)
  await save([...o.lineItems.map(strip), ...moreLines]); o = await cur()
  ok('eight piece types saved on one order', o?.lineItems?.length === 8 && ['Bracelet', 'Ring', 'Chain', 'Loose stone', 'Earrings', 'Necklace', 'Watch', 'Other'].every((t) => o.lineItems.some((l) => l.productType === t)))
  // edit the SECOND line while the first exists; the first must be untouched
  await save(o.lineItems.map((l) => strip(l.productType === 'Ring' ? { ...l, ringSize: '7', unitPriceCents: 1250000 } : l))); o = await cur()
  const b3 = o.lineItems.find((l) => l.productType === 'Bracelet'), r3 = o.lineItems.find((l) => l.productType === 'Ring')
  ok('editing the ring changes only the ring; the bracelet keeps every field', r3?.ringSize === '7' && r3?.unitPriceCents === 1250000 && b3?.stoneQuality === 'VVS1' && b3?.internalCostCents === 210000 && JSON.stringify(b3?.sideStoneShapes) === '["Round","Baguette"]' && b3?.measurements === "7''")
  // unrelated field on the order, lines re-sent unchanged
  await save(o.lineItems.map(strip), { assignedEmployee: 'Bench 2', internalNotes: 'rush' }); o = await cur()
  const w3 = o.lineItems.find((l) => l.productType === 'Watch'), e3 = o.lineItems.find((l) => l.productType === 'Earrings')
  ok('changing an unrelated field keeps all eight lines and their specs', o.assignedEmployee === 'Bench 2' && o.lineItems.length === 8 && w3?.customSpec === 'Box and papers' && e3?.centerStoneCarat === 1.0 && o.lineItems.find((l) => l.productType === 'Loose stone')?.stoneOrigin === 'Lab Grown')
  // tax change alone (no lines in the patch) must not touch lines or deposit
  await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ taxChoiceId: 'ON' }) }); o = await cur()
  ok('a tax-only save leaves the eight lines alone and switches the snapshot to ON 13%', o.lineItems.length === 8 && o.taxRatePercent === 13 && o.deliveryProvince === 'ON')
  await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ taxChoiceId: 'BC:combined' }) })
  // remove one, reorder the rest
  const without = o.lineItems.filter((l) => l.productType !== 'Other').map(strip).reverse()
  await save(without); o = await cur()
  ok('removing one and reversing the order keeps the seven others with their values, in the new order', o.lineItems.length === 7 && o.lineItems[0].productType === 'Watch' && o.lineItems[6].productType === 'Bracelet' && o.lineItems.find((l) => l.productType === 'Necklace')?.measurements === "18''")
  ok('subtotal follows the lines exactly', o.subtotalCents === o.lineItems.reduce((t, l) => t + l.lineTotalCents, 0))

  // ── Nobody without a session can change anything ────────────────────────────────────────────
  console.log('\nPermissions (logged out)')
  const anon = async (path, init = {}) => (await fetch(`${APP}${path}`, { ...init, headers: { 'content-type': 'application/json' }, redirect: 'manual' })).status
  const refused = (st) => st === 401 || st === 404 || st === 307
  ok('stage move refused', refused(await anon(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'production' }) })))
  ok('payment refused', refused(await anon(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'deposit', amountCents: 100, method: 'cash' }) })))
  ok('share link refused', refused(await anon(`/api/orders/${orderId}/shares`, { method: 'POST', body: JSON.stringify({ docType: 'estimate' }) })))
  ok('order edit refused', refused(await anon(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ customerName: 'x' }) })))
  ok('order delete refused', refused(await anon(`/api/orders/${orderId}`, { method: 'DELETE' })))
  ok('memo refused', refused(await anon('/api/memos', { method: 'POST', body: JSON.stringify({ direction: 'out' }) })))
  ok('purchase refused', refused(await anon(`/api/orders/${orderId}/purchases`, { method: 'POST', body: JSON.stringify({ description: 'x' }) })))
  ok('approval send refused', refused(await anon(`/api/orders/${orderId}/approvals`, { method: 'POST', body: JSON.stringify({ approvalType: 'customer', recipientEmail: 'a@b.co' }) })))
  ok('order read refused', refused(await anon(`/api/orders/${orderId}`)))
  ok('a negative payment is refused even when signed in', (await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'deposit', amountCents: -500, method: 'cash' }) })).status === 400)
  ok('a zero payment is refused', (await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'deposit', amountCents: 0, method: 'cash' }) })).status === 400)
  ok('an unknown stage is refused', (await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'shipped' }) })).status === 400)

  // ── Estimate + public link ───────────────────────────────────────────────────────────────────
  console.log('\nEstimate and the customer link')
  const est = await page(`/orders/${orderId}/document/estimate`)
  ok(`internal estimate renders for the owner (${est.status})`, est.status === 200 && est.html.includes(`${TAG} tennis bracelet`))
  ok('the internal page says the address bar is not the customer link, and copies one', /Copy customer link/.test(est.html) && /Internal view — customers use the link below/.test(est.html))
  const cert = await upload(orderId, 'GIA-cert.pdf', 'application/pdf', PDF)
  const vid = await upload(orderId, 'turning.mp4', 'video/mp4', MP4)
  ok(`certificate PDF and video uploaded (${cert.status}, ${vid.status})`, cert.status === 200 && vid.status === 200)
  const sh = await api(`/api/orders/${orderId}/shares`, { method: 'POST', body: JSON.stringify({ docType: 'estimate' }) })
  shareUrl = sh.body?.url
  ok(`customer link minted without emailing (${sh.status})`, sh.status === 200 && /\/e\/[A-Za-z0-9_-]{43}$/.test(shareUrl ?? ''))
  const pub = await fetch(shareUrl, { redirect: 'manual' }); const pubHtml = await pub.text()
  ok(`LOGGED OUT: the customer link opens (${pub.status})`, pub.status === 200)
  ok('no login, no sidebar, no dashboard navigation on the customer copy', !/\/auth\/login|href="\/dashboard"|href="\/inbox"|href="\/orders"/.test(pubHtml))
  ok('no platform brand on the customer copy', !/Scalix26/i.test(pubHtml))
  ok('no internal cost on the customer copy', !pubHtml.includes('2,100') && !pubHtml.includes('2100'))
  ok('the certificate is listed and the video is embedded, both through the token route', /Certificates &amp; documents/.test(pubHtml) && pubHtml.includes('GIA-cert.pdf') && /<video[^>]+src="\/e\/[^"]+\/file\//.test(pubHtml))
  const fileLinks = [...pubHtml.matchAll(/\/e\/([A-Za-z0-9_-]{43})\/file\/([0-9a-f-]{36})/g)].map((m) => m[0])
  const certOk = await fetch(`${APP}${fileLinks.find((l) => l.endsWith(cert.body?.attachment?.id)) ?? '/nope'}`, { redirect: 'manual' })
  ok(`LOGGED OUT: the certificate opens (302 → storage; got ${certOk.status})`, certOk.status === 302 && /storage\/v1\/object\/sign/.test(certOk.headers.get('location') ?? ''))
  const vidOk = await fetch(`${APP}${fileLinks.find((l) => l.endsWith(vid.body?.attachment?.id)) ?? '/nope'}`, { redirect: 'manual' })
  ok(`LOGGED OUT: the video opens (302 → storage; got ${vidOk.status})`, vidOk.status === 302)
  // ── The sent copy is a record ────────────────────────────────────────────────────────────────
  {
    const before = await (await fetch(shareUrl)).text()
    const priceBefore = /4,990\.00|4990\.00/.test(before)
    // Edit the order: raise the bracelet's price. The old link must not move; a new link must.
    const oNow = await cur()
    await save(oNow.lineItems.map((l) => strip(l.productType === 'Bracelet' ? { ...l, unitPriceCents: 777700 } : l)))
    const after = await (await fetch(shareUrl)).text()
    ok('editing the order does not change the estimate the customer was sent', priceBefore && /4,990\.00|4990\.00/.test(after) && !/7,777\.00|7777\.00/.test(after))
    const sh2 = await api(`/api/orders/${orderId}/shares`, { method: 'POST', body: JSON.stringify({ docType: 'estimate' }) })
    const fresh = await (await fetch(sh2.body?.url)).text()
    const oldAgain = await (await fetch(shareUrl)).text()
    ok('a new link shows the new price; minting it did not touch the old copy', /7,777\.00|7777\.00/.test(fresh) && /4,990\.00|4990\.00/.test(oldAgain))
    const shares = await api(`/api/orders/${orderId}/shares`)
    const first = (shares.body?.shares ?? []).slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    const asSent = await page(`/orders/${orderId}/shares/${first?.id}`)
    ok('"View as sent" renders the historical copy, not the live order', asSent.status === 200 && /4,990\.00|4990\.00/.test(asSent.html) && /Copy as sent/.test(asSent.html))
    // Files: a new upload does not disturb what the old copy names; deleting a named file is refused;
    // making it internal withholds it from the sent copy without breaking a link.
    const extra = await upload(orderId, 'later-photo.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
    const oldStill = await (await fetch(shareUrl)).text()
    ok('uploading another file leaves the old copy exactly as it was (no new file on it)', extra.status === 200 && !oldStill.includes('later-photo.jpg') && oldStill.includes('GIA-cert.pdf'))
    const delCert = await api(`/api/orders/${orderId}/attachments/${cert.body?.attachment?.id}`, { method: 'DELETE' })
    ok(`deleting the certificate a sent copy names is refused (${delCert.status})`, delCert.status === 409 && /kept for the record/.test(delCert.body?.error ?? ''))
    const certStill = await fetch(`${APP}${fileLinks.find((l) => l.endsWith(cert.body?.attachment?.id))}`, { redirect: 'manual' })
    ok('the certificate still opens from the old link after the refused delete', certStill.status === 302)
    await api(`/api/orders/${orderId}/attachments/${cert.body?.attachment?.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'internal' }) })
    const withheld = await (await fetch(shareUrl)).text()
    ok('made internal: the sent copy withholds the certificate rather than showing a dead link', !withheld.includes('GIA-cert.pdf'))
    await api(`/api/orders/${orderId}/attachments/${cert.body?.attachment?.id}`, { method: 'PATCH', body: JSON.stringify({ visibility: 'public' }) })
    ok('made public again: it is back on the sent copy (nothing was lost)', (await (await fetch(shareUrl)).text()).includes('GIA-cert.pdf'))
    const delExtra = await api(`/api/orders/${orderId}/attachments/${extra.body?.attachment?.id}`, { method: 'DELETE' })
    ok('a file no sent copy names can still be deleted', delExtra.status === 200)
    await save((await cur()).lineItems.map((l) => strip(l.productType === 'Bracelet' ? { ...l, unitPriceCents: 499000 } : l)))
  }

  const internal = await page(`/orders/${orderId}/document/estimate`, false)
  ok(`the INTERNAL document URL still requires login when copied (${internal.status} → ${internal.location})`, internal.status === 307 && /\/auth\/login/.test(internal.location ?? ''))

  // ── Closed no sale → reopen ──────────────────────────────────────────────────────────────────
  console.log('\nClosed – No Sale')
  const cns = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'closed_no_sale', note: 'went with another jeweller' }) })
  const g3 = await api(`/api/orders/${orderId}`)
  ok(`close as no sale (${cns.status}); order, seven lines, two files still there`, cns.status === 200 && g3.body?.order?.stage === 'closed_no_sale' && g3.body?.order?.lineItems?.length === 7)
  const openList = await page('/orders')
  const noSaleList = await page('/orders?view=no_sale')
  ok('gone from Open, listed under Closed – No Sale', !openList.html.includes(o1.body.order.orderNumber) && noSaleList.html.includes(o1.body.order.orderNumber))
  const hist1 = await page(`/contacts/${contactId}`)
  ok('customer page still shows the estimate, marked Closed – No Sale', hist1.html.includes(o1.body.order.orderNumber) && /Closed – No Sale/.test(hist1.html))
  const del = await api(`/api/orders/${orderId}`, { method: 'DELETE' })
  ok(`delete is refused once a link has gone out (${del.status})`, del.status === 409)
  const reopen = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'new' }) })
  const g4 = await api(`/api/orders/${orderId}`)
  const ev = g4.body?.order?.events ?? []
  ok(`reopen → new (${reopen.status}); history has both moves with the reason`, reopen.status === 200 && g4.body?.order?.stage === 'new' && ev.some((e) => e.type === 'stage_changed' && e.payload?.to === 'closed_no_sale' && e.payload?.note === 'went with another jeweller') && ev.some((e) => e.type === 'stage_changed' && e.payload?.from === 'closed_no_sale' && e.payload?.to === 'new'))

  // ── In process ───────────────────────────────────────────────────────────────────────────────
  console.log('\nIn Process')
  const ip = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'in_process', note: 'verbal yes on the phone' }) })
  if (isPending(ip, 1)) pend('move to In Process (stage CHECK)', 1)
  else {
    ok(`move to In Process (${ip.status})`, ip.status === 200)
    const board = await page('/orders/board')
    ok('board shows the card under In Process, with the ⋯ move menu', board.html.includes(o1.body.order.orderNumber) && /In Process/.test(board.html) && /Move to…/.test(board.html))
    const hist2 = await page(`/contacts/${contactId}`)
    ok('customer history shows it as In Process', /In Process/.test(hist2.html))
  }

  // ── Payments ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nPayments')
  const subtotal = (await cur()).subtotalCents, total = Math.round(subtotal * 1.12)
  const p1 = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'deposit', amountCents: 100000, method: 'card', reference: 'TERM-1', paidOn: '2026-09-14', idempotencyKey: `${TAG}-dep` }) })
  ok(`deposit 1,000 by card (${p1.status})`, p1.status === 200 && p1.body?.totals?.paidCents === 100000)
  const p1again = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'deposit', amountCents: 100000, method: 'card', reference: 'TERM-1', paidOn: '2026-09-14', idempotencyKey: `${TAG}-dep` }) })
  ok('the same deposit sent twice (same key) is recorded once', p1again.status === 200 && p1again.body?.totals?.paidCents === 100000)
  const p2 = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'payment', amountCents: 500000, method: 'etransfer', reference: 'ET-99', paidOn: '2026-09-15' }) })
  ok(`partial payment 5,000 by e-transfer (${p2.status})`, p2.status === 200 && p2.body?.totals?.paidCents === 600000)
  if (p2.body?.degraded) { pend(`e-transfer stored as 'transfer' until the ledger learns the word`, 2); ok('the fallback note names no database detail', !/migration|column|SQL/i.test(p2.body.degraded)) }
  const g5 = await api(`/api/orders/${orderId}`)
  const detail = await page(`/orders/${orderId}`)
  ok('after re-read: deposit_cents = 6,000 and the page shows Balance due', g5.body?.order?.depositCents === 600000 && /Balance due/.test(detail.html) && /Partly paid/.test(detail.html))
  const remaining = total - 600000
  const p3 = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'payment', amountCents: remaining, method: 'cash', paidOn: '2026-09-16' }) })
  ok(`final payment ${(remaining / 100).toFixed(2)} → paid in full`, p3.status === 200 && p3.body?.totals?.status === 'paid' && p3.body?.totals?.dueCents === 0)
  const inv = await page(`/orders/${orderId}/document/invoice`)
  ok('invoice document: tax line + total + deposit received + balance due 0', /GST \+ PST/.test(inv.html) && /Deposit received/.test(inv.html) && /Balance due/.test(inv.html))
  const p4 = await api(`/api/orders/${orderId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'refund', amountCents: 50000, method: 'card', reference: 'REF-1' }) })
  ok(`refund 500 → balance due 500 again (${p4.status})`, p4.status === 200 && p4.body?.totals?.dueCents === 50000 && p4.body?.totals?.status === 'partial')
  const g6 = await api(`/api/orders/${orderId}`)
  ok('after re-read: ledger sum 5 payments net, deposit_cents matches, events for each', g6.body?.order?.depositCents === total - 50000 && (g6.body?.order?.events ?? []).filter((e) => e.type === 'payment_recorded').length === 4)

  // ── Production / CAD board ───────────────────────────────────────────────────────────────────
  console.log('\nProduction board')
  const moves = [['production', 'stone arrived'], ['customer_changes_requested', 'wants a wider band'], ['ready', 'QC passed']]
  let movesOk = true
  for (const [to, note] of moves) { const r = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: to, note }) }); movesOk = movesOk && r.status === 200 }
  const g7 = await api(`/api/orders/${orderId}`)
  const stageEvents = (g7.body?.order?.events ?? []).filter((e) => e.type === 'stage_changed')
  ok('forward, backward and non-adjacent moves all accepted; order now Ready', movesOk && g7.body?.order?.stage === 'ready')
  ok('history has every move with from → to and the reason', stageEvents.some((e) => e.payload?.from === 'production' && e.payload?.to === 'customer_changes_requested' && e.payload?.note === 'wants a wider band') && stageEvents.some((e) => e.payload?.from === 'customer_changes_requested' && e.payload?.to === 'ready'))
  const detail2 = await page(`/orders/${orderId}`)
  ok('timeline prints names, not uuids, for the actor', !/·\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(detail2.html.replace(/href="[^"]*"/g, '')))

  // ── Invoice before completion ────────────────────────────────────────────────────────────────
  console.log('\nInvoice before completion')
  const raise = await api(`/api/orders/${orderId}/finish`, { method: 'POST', body: JSON.stringify({ action: 'invoice' }) })
  const g8 = await api(`/api/orders/${orderId}`)
  ok(`invoice raised while the order is Ready, not completed (${raise.status})`, raise.status === 200 && !!g8.body?.order?.invoicedAt && g8.body?.order?.stage === 'ready')

  // ── Closed order ─────────────────────────────────────────────────────────────────────────────
  console.log('\nClosed Order')
  const done = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'completed' }) })
  const openList2 = await page('/orders'); const doneList = await page('/orders?view=done'); const hist3 = await page(`/contacts/${contactId}`); const detail3 = await page(`/orders/${orderId}`)
  ok(`completed (${done.status}): out of Open, in Closed Orders, on the customer, badged Closed Order`, done.status === 200 && !openList2.html.includes(o1.body.order.orderNumber) && doneList.html.includes(o1.body.order.orderNumber) && hist3.html.includes(o1.body.order.orderNumber) && /Closed Order/.test(detail3.html))
  const badDrag = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'production' }) })
  const reopen2 = await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'delivered' }) })
  ok(`a closed order refuses a free drag (${badDrag.status}) and reopens only through its Reopen target (${reopen2.status})`, badDrag.status === 400 && reopen2.status === 200)
  await api(`/api/orders/${orderId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'completed' }) })

  // ── Vendor quotation (a second order, still live) ───────────────────────────────────────────
  console.log('\nVendor quotation')
  const o2 = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contactId, customerName: `Smoke ${TAG}`, currency: 'cad', lineItems: [{ productType: 'Ring', productName: `${TAG} quote ring`, quantity: 1, unitPriceCents: 300000, metalKarat: '18K Yellow Gold' }] }) })
  const order2 = o2.body?.order?.id; if (order2) made.orders.push(order2)
  const sup = await api('/api/suppliers', { method: 'POST', body: JSON.stringify({ name: `${TAG} Casting House`, email: env.PROBE_EMAIL }) })
  const supplierId = sup.body?.supplier?.id; if (supplierId) made.suppliers.push(supplierId)
  const q = await api(`/api/orders/${order2}/approvals`, { method: 'POST', body: JSON.stringify({ approvalType: 'factory', supplierId, requestKind: 'quote', message: 'Please quote this piece.' }) })
  const aps = await api(`/api/orders/${order2}/approvals`)
  const quote = (aps.body?.approvals ?? [])[0]
  ok(`quotation request sent to the factory on the right order (${q.status})`, q.status === 200 && !!quote && quote.approvalType === 'factory', q.body)
  if (quote?.requestKind === 'quote') ok('it is recorded as a QUOTATION, distinct from customer approval', true)
  else pend('request_kind column — the request went out as a plain factory approval', 7)

  // ── Purchase ─────────────────────────────────────────────────────────────────────────────────
  console.log('\nPurchase')
  const pu = await api(`/api/orders/${order2}/purchases`, { method: 'POST', body: JSON.stringify({ kind: 'stone', description: `${TAG} 1.20ct oval`, costCents: 210000, supplierId, supplierName: `${TAG} Casting House`, status: 'waiting', orderedOn: '2026-09-14' }) })
  if (isPending(pu, 5)) pend('purchases table', 5)
  else {
    const pid = pu.body?.purchase?.id
    ok(`purchase created on the order (${pu.status})`, pu.status === 200 && !!pid)
    let flow = true
    for (const st of ['in_production', 'shipped', 'received', 'qc_done']) { const r = await api(`/api/orders/${order2}/purchases/${pid}`, { method: 'PATCH', body: JSON.stringify({ status: st }) }); flow = flow && r.status === 200 && r.body?.purchase?.status === st }
    const lst = await api(`/api/orders/${order2}/purchases`)
    ok('progressed waiting → in production → shipped → received → QC passed, received date stamped', flow && lst.body?.purchases?.[0]?.status === 'qc_done' && !!lst.body?.purchases?.[0]?.receivedOn)
  }

  // ── Memo A: our stock out and back ───────────────────────────────────────────────────────────
  console.log('\nMemo — our piece out on memo')
  const prod = await api('/api/catalog/products', { method: 'POST', body: JSON.stringify({ name: `${TAG} stock sapphire ring`, sku: `${TAG}-SR`, showroom_quantity: 1, warehouse_quantity: 0, storage_quantity: 0, price: 2500, status: 'active', availability_status: 'in_stock' }) })
  const productId = prod.body?.product?.id ?? prod.body?.id; if (productId) made.products.push(productId)
  ok(`stock item created, 1 in showroom (${prod.status})`, prod.status === 200 && !!productId)
  const m1 = await api('/api/memos', { method: 'POST', body: JSON.stringify({ direction: 'out', kind: 'memo', catalogProductId: productId, quantity: 1, fromLocation: 'showroom', contactId, counterpartyName: `Smoke ${TAG}`, agreedPriceCents: 250000, currency: 'cad', dueOn: '2026-09-30' }) })
  if (isPending(m1, 4)) pend('memos table / catalog ownership columns', 4)
  else {
    const memoId = m1.body?.memo?.id; if (memoId) made.memos.push(memoId)
    const pr1 = await api(`/api/catalog/products/${productId}`)
    ok(`sent on memo (${m1.status}): showroom 0, on memo 1, unavailable`, m1.status === 200 && pr1.body?.product?.showroom_quantity === 0 && pr1.body?.product?.on_memo_quantity === 1 && pr1.body?.product?.availability_status === 'out_of_stock', m1.body)
    const memoList = await page('/orders/memos')
    ok('memo listed as Sent on memo', memoList.html.includes(`${TAG} stock sapphire ring`) && /Sent on memo/.test(memoList.html))
    const fu = await api(`/api/memos/${memoId}`, { method: 'POST', body: JSON.stringify({ to: 'follow_up', dueOn: '2026-09-20', note: 'called, deciding' }) })
    const ret = await api(`/api/memos/${memoId}`, { method: 'POST', body: JSON.stringify({ to: 'returned', toLocation: 'showroom' }) })
    const pr2 = await api(`/api/catalog/products/${productId}`)
    ok(`follow-up then returned (${fu.status}, ${ret.status}): showroom 1, on memo 0, in stock again`, fu.status === 200 && ret.status === 200 && pr2.body?.product?.showroom_quantity === 1 && pr2.body?.product?.on_memo_quantity === 0 && pr2.body?.product?.availability_status === 'in_stock')
    const kinds = (pr2.body?.movements ?? []).map((m) => m.movement_type)
    ok('catalog ledger has memo_out and memo_return', kinds.includes('memo_out') && kinds.includes('memo_return'))
    const again = await api(`/api/memos/${memoId}`, { method: 'POST', body: JSON.stringify({ to: 'returned' }) })
    ok(`a settled memo cannot be moved again (${again.status}) — no double stock movement`, again.status === 400)
    const mh = await page(`/orders/memos/${memoId}`)
    ok('memo history shows opened → follow up → returned with the note', /Memo opened/.test(mh.html) && /called, deciding/.test(mh.html))

    // ── Memo B: a supplier's piece in, then back to the supplier ──────────────────────────────
    console.log('\nMemo — supplier piece received, then returned')
    const m2 = await api('/api/memos', { method: 'POST', body: JSON.stringify({ direction: 'in', kind: 'memo', itemDescription: `${TAG} supplier 2ct oval`, quantity: 1, fromLocation: 'showroom', supplierId, counterpartyName: `${TAG} Casting House`, agreedPriceCents: 900000, costCents: 600000, currency: 'cad' }) })
    const memo2 = m2.body?.memo; if (memo2?.id) made.memos.push(memo2.id); if (memo2?.catalogProductId) made.products.push(memo2.catalogProductId)
    const sp1 = await api(`/api/catalog/products/${memo2?.catalogProductId}`)
    ok(`received on memo (${m2.status}): entered as stock, ownership memo_in, owner = counterparty`, m2.status === 200 && memo2?.owner === 'counterparty' && sp1.body?.product?.ownership === 'memo_in' && sp1.body?.product?.showroom_quantity === 1)
    const notOurs = await api('/api/memos', { method: 'POST', body: JSON.stringify({ direction: 'out', catalogProductId: memo2?.catalogProductId, quantity: 1, counterpartyName: 'someone' }) })
    ok(`a supplier's piece cannot be sent out as OUR memo (${notOurs.status})`, notOurs.status === 400)
    const ret2 = await api(`/api/memos/${memo2?.id}`, { method: 'POST', body: JSON.stringify({ to: 'returned' }) })
    const sp2 = await api(`/api/catalog/products/${memo2?.catalogProductId}`)
    ok(`returned to supplier (${ret2.status}): quantity 0, out of stock, archived — never company inventory`, ret2.status === 200 && sp2.body?.product?.showroom_quantity === 0 && sp2.body?.product?.availability_status === 'out_of_stock' && !!sp2.body?.product?.archived_at)
    ok('catalog ledger has memo_in and memo_return_supplier', (sp2.body?.movements ?? []).some((m) => m.movement_type === 'memo_in') && (sp2.body?.movements ?? []).some((m) => m.movement_type === 'memo_return_supplier'))

    // ── Consignment ──────────────────────────────────────────────────────────────────────────
    console.log('\nConsignment')
    const m3 = await api('/api/memos', { method: 'POST', body: JSON.stringify({ direction: 'in', kind: 'consignment', itemDescription: `${TAG} consigned estate brooch`, supplierId, counterpartyName: `${TAG} Casting House`, agreedPriceCents: 400000, costCents: 300000, currency: 'cad' }) })
    const memo3 = m3.body?.memo; if (memo3?.id) made.memos.push(memo3.id); if (memo3?.catalogProductId) made.products.push(memo3.catalogProductId)
    const cp = await api(`/api/catalog/products/${memo3?.catalogProductId}`)
    ok(`consignment: ownership explicit on the product (consignment) and the memo (counterparty)`, m3.status === 200 && cp.body?.product?.ownership === 'consignment' && memo3?.owner === 'counterparty')
    const sold = await api(`/api/memos/${memo3?.id}`, { method: 'POST', body: JSON.stringify({ to: 'sold', soldPriceCents: 420000 }) })
    const settle = await api(`/api/memos/${memo3?.id}`, { method: 'POST', body: JSON.stringify({ settle: true }) })
    ok(`sold for 4,200, supplier marked paid (${sold.status}, ${settle.status})`, sold.status === 200 && settle.status === 200)
  }

  // ── Repair ───────────────────────────────────────────────────────────────────────────────────
  console.log('\nRepair')
  const rp = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contactId, customerName: `Smoke ${TAG}`, currency: 'cad', orderKind: 'repair', kindDetails: { itemDescription: '14K ring, prong lifted', repairRequested: 'Re-tip two prongs, polish' }, lineItems: [{ productType: 'Ring', productName: `${TAG} repair — re-tip`, quantity: 1, unitPriceCents: 12000 }] }) })
  const repairId = rp.body?.order?.id; if (repairId) made.orders.push(repairId)
  const rg1 = await api(`/api/orders/${repairId}`)
  if (rg1.body?.order?.orderKind !== 'repair') pend('order_kind column — repair created as a plain order', 6)
  else ok('repair intake recorded with the item and the request', rg1.body.order.kindDetails?.repairRequested === 'Re-tip two prongs, polish')
  let rflow = true
  for (const to of ['in_process', 'production', 'ready']) { const r = await api(`/api/orders/${repairId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: to }) }); rflow = rflow && (r.status === 200 || !!isPending(r, 1)) }
  const rinv = await api(`/api/orders/${repairId}/finish`, { method: 'POST', body: JSON.stringify({ action: 'invoice' }) })
  const rpay = await api(`/api/orders/${repairId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'payment', amountCents: 12000, method: 'cash' }) })
  const rdone = await api(`/api/orders/${repairId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'finished' }) })
  ok(`repair: intake → in process → production → ready → invoice → paid → closed (${rinv.status}, ${rpay.status}, ${rdone.status})`, rflow && rinv.status === 200 && rpay.body?.totals?.status === 'paid' && rdone.status === 200)

  // ── Appraisal ────────────────────────────────────────────────────────────────────────────────
  console.log('\nAppraisal')
  const ap = await api('/api/orders', { method: 'POST', body: JSON.stringify({ contactId, customerName: `Smoke ${TAG}`, currency: 'cad', orderKind: 'appraisal', kindDetails: { itemDescription: 'Ladies Rolex Datejust', purpose: 'insurance', appraiser: 'A. Gemmologist' }, lineItems: [{ productType: 'Watch', productName: `${TAG} appraisal — watch`, quantity: 1, unitPriceCents: 15000 }] }) })
  const apprId = ap.body?.order?.id; if (apprId) made.orders.push(apprId)
  const ag1 = await api(`/api/orders/${apprId}`)
  if (ag1.body?.order?.orderKind !== 'appraisal') pend('order_kind column — appraisal created as a plain order', 6)
  else ok('appraisal intake: purpose insurance, appraiser, item', ag1.body.order.kindDetails?.purpose === 'insurance' && ag1.body.order.kindDetails?.appraiser === 'A. Gemmologist')
  const apdf = await upload(apprId, 'Appraisal-report.pdf', 'application/pdf', PDF)
  const apay = await api(`/api/orders/${apprId}/payments`, { method: 'POST', body: JSON.stringify({ kind: 'payment', amountCents: 15000, method: 'card', reference: 'TERM-2' }) })
  const adone = await api(`/api/orders/${apprId}/stage`, { method: 'POST', body: JSON.stringify({ toStage: 'finished' }) })
  const ash = await api(`/api/orders/${apprId}/shares`, { method: 'POST', body: JSON.stringify({ docType: 'invoice' }) })
  const apub = await (await fetch(ash.body?.url ?? `${APP}/e/x`)).text()
  ok(`appraisal: PDF attached, paid, closed, and the customer's invoice copy lists the PDF (${apdf.status}, ${apay.status}, ${adone.status})`, apdf.status === 200 && apay.body?.totals?.status === 'paid' && adone.status === 200 && apub.includes('Appraisal-report.pdf'))

  // ── The customer's history, at the end ───────────────────────────────────────────────────────
  console.log('\nCustomer history')
  const hist = await page(`/contacts/${contactId}`)
  const h = hist.html
  const nums = [o1.body.order.orderNumber, o2.body?.order?.orderNumber, rp.body?.order?.orderNumber, ap.body?.order?.orderNumber].filter(Boolean)
  ok(`all ${nums.length} orders on the customer (estimate, quotation order, repair, appraisal)`, nums.every((n) => h.includes(n)))
  ok('closed order and invoiced marked; payments and memos sections present', /Closed Order/.test(h) && /Invoiced/.test(h) && /Payments ·/.test(h) && (made.memos.length === 0 || /Memos ·/.test(h)))
  // Visible text only: scripts (the RSC payload carries route ids) and attributes are not text.
  const visible = h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  const leaked = />([^<]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^<]*)</.exec(visible)
  ok('no raw uuid in the visible text of the customer page', !leaked, leaked?.[1])
} catch (e) {
  ok(`unexpected error: ${e.stack || e.message}`, false)
} finally {
  // ── Cleanup — everything this run made, in dependency order ───────────────────────────────────
  for (const id of made.memos) { await srest(`memo_events?memo_id=eq.${id}`, { method: 'DELETE' }); await srest(`memos?id=eq.${id}`, { method: 'DELETE' }) }
  for (const id of made.orders) {
    const atts = await (await srest(`order_attachments?select=storage_path&order_id=eq.${id}`)).json().catch(() => [])
    if (Array.isArray(atts) && atts.length) await fetch(`${SB}/storage/v1/object/order-attachments`, { method: 'DELETE', headers: SH, body: JSON.stringify({ prefixes: atts.map((a) => a.storage_path) }) })
    await srest(`payment_allocations?document_type=eq.order&document_id=eq.${id}`, { method: 'DELETE' })
    await srest(`order_purchases?order_id=eq.${id}`, { method: 'DELETE' })
    await srest(`orders?id=eq.${id}`, { method: 'DELETE' }) // lines, events, attachments, shares, approvals cascade
  }
  for (const id of made.products) { await srest(`catalog_movements?product_id=eq.${id}`, { method: 'DELETE' }); await srest(`catalog_products?id=eq.${id}`, { method: 'DELETE' }) }
  for (const id of made.suppliers) await srest(`suppliers?id=eq.${id}`, { method: 'DELETE' })
  for (const id of made.contacts) { await srest(`conversations?contact_id=eq.${id}`, { method: 'DELETE' }); await srest(`contacts?id=eq.${id}`, { method: 'DELETE' }) }
  console.log(`\n${pass} passed, ${fail} failed, ${pending} pending migration — SMOKE rows removed.`)
  process.exit(fail ? 1 : 0)
}
