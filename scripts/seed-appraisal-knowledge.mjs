// Seed the appraisal Q&A knowledge for ONE AI employee (the gem-lab / appraisal assistant).
//
//   node scripts/seed-appraisal-knowledge.mjs <ai_employee_id> [--replace]
//
// ── WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────
//
// Roughly a hundred questions customers ask an appraisal lab, with answers, grouped into twelve
// knowledge_base entries by topic. They are written as TENANT DATA — rows in knowledge_base owned
// by the given agent (ai_employee_id = that agent, so the jeweller's agent on the same tenant never
// reads them) — and every row is editable in the app afterwards. Nothing here is compiled into the
// application and nothing is priced in code: the prices live in ONE entry ("Appraisal pricing")
// so she changes them in one place.
//
// Idempotent: an entry whose title already exists for this agent is skipped, unless --replace is
// given, in which case the seeded titles are replaced and every other row is left alone. Manual
// knowledge she has added under other titles is never touched.
//
// Searched before writing (2026-09-14): knowledge_base held three website-scan rows for this
// tenant and no Q&A anywhere — no seed file, no prompt file, no archived config. This is the
// first copy.

import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }),
)
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const KEY = env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=representation' }
const rest = (p, o = {}) => fetch(`${SB}/rest/v1/${p}`, { headers: H, ...o })

const agentId = process.argv[2]
const replace = process.argv.includes('--replace')
if (!agentId) { console.error('Usage: node scripts/seed-appraisal-knowledge.mjs <ai_employee_id> [--replace]'); process.exit(1) }

const qa = (pairs) => pairs.map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n')

// ── THE ENTRIES ─────────────────────────────────────────────────────────────────────────────────
// Prices are only in the first entry. Every other answer says "see Appraisal pricing" where a
// number would go, so the assistant reads the current figure rather than a stale one.
const ENTRIES = [
  ['Appraisal pricing', `Our appraisal fees (edit this entry to change them — it is the only place prices are kept):

- Standard appraisal: from $80 per piece.
- Complicated pieces — watches, antique and estate pieces, multi-stone or multi-component items: $120 to $250 per item, quoted on seeing the piece.
- Multiple pieces appraised at the same visit may be discounted; ask when booking.
- Updates of an appraisal we issued previously, with no change to the piece: reduced fee, quoted on request.
- Payment is due when the appraisal is delivered. We accept card, cash, e-transfer.

When a customer asks the price, give the starting figure and say the exact fee depends on the piece; offer to book a time or invite them to send a photo.`],

  ['Insurance appraisals', qa([
    ['What is an insurance appraisal?', 'A written, signed document describing your piece in detail — stones, metal, weights, measurements, quality grades, photographs — with a replacement value for insurance purposes. Your insurer uses it to set the coverage and to replace the piece if it is lost, stolen or damaged.'],
    ['What value does an insurance appraisal state?', 'Retail replacement value: what it would cost to replace the piece with one of like kind and quality at a retail jeweller today. It is usually higher than what you paid and is not the resale value.'],
    ['Do I need an appraisal to insure my jewellery?', 'Most insurers ask for a current appraisal for any item above a certain value — often around a thousand dollars — before they will schedule it on a policy. Check your insurer\'s threshold; we can write the appraisal to their requirements.'],
    ['How often should an insurance appraisal be updated?', 'Every two to three years, or sooner if metal and diamond prices move sharply. Insurers may refuse a claim against an old valuation, and an out-of-date value can leave you under-insured.'],
    ['Can you update an appraisal you wrote before?', 'Yes. If the piece is unchanged we re-examine it, confirm the description and issue a new value at a reduced fee — see Appraisal pricing.'],
    ['Will my insurer accept your appraisal?', 'Our appraisals are prepared by qualified gemmologists and follow the format insurers expect: full description, grading, photographs, the appraiser\'s credentials and signature. If your insurer has a specific form or requirement, bring it and we will follow it.'],
    ['Does the appraisal include photographs?', 'Yes — clear photographs of the piece are part of every appraisal, which also helps an insurer identify it in a claim.'],
    ['Can you appraise a piece I bought online or abroad?', 'Yes. We appraise the piece in front of us regardless of where it was bought. If it came with a certificate, bring it; we verify the stone against it.'],
    ['I have the receipt — do I still need an appraisal?', 'A receipt shows what you paid, not what it would cost to replace today, and it does not describe the piece the way an insurer needs. Most insurers want an appraisal.'],
    ['Can you appraise a piece for a claim that already happened?', 'If the piece is gone we cannot examine it. We may be able to prepare a post-loss valuation from documentation — photographs, receipts, an earlier appraisal, a lab report — and we will say clearly what it is based on.'],
  ])],

  ['Estate and probate appraisals', qa([
    ['What is an estate appraisal?', 'A valuation of jewellery from an estate — for probate, for dividing items fairly among heirs, for tax purposes, or before a sale. The value basis is different from an insurance appraisal.'],
    ['What value does an estate appraisal use?', 'Usually fair market value — what the piece would sell for between a willing buyer and a willing seller in the appropriate market — rather than retail replacement. We state the basis on the document.'],
    ['Can you appraise a whole collection?', 'Yes. For a collection we can work through it at our lab or, for larger estates, discuss visiting. Each piece is described and valued individually and summarised in one report.'],
    ['Do you provide appraisals for the executor or lawyer?', 'Yes. We can address the report to the executor or the estate\'s lawyer and provide the format they need for probate filings.'],
    ['How do you value pieces of sentimental but little monetary value?', 'Honestly. Each piece is described and given its fair market value, however small. Sentimental value is real but it is not something an appraisal can put a number on.'],
    ['Can you help divide jewellery between family members fairly?', 'An estate appraisal gives each piece a value on the same basis, which is what families use to divide items fairly. We do not decide who gets what, but we give you the numbers to do it with.'],
    ['Do you buy estate jewellery you have appraised?', 'We keep appraisal and buying separate so the valuation is independent. If you decide to sell, we can explain your options.'],
    ['What should I bring for an estate appraisal?', 'The pieces, any boxes, receipts, earlier appraisals or certificates, and if applicable the name the report should be addressed to. Nothing needs to be cleaned or sorted first.'],
  ])],

  ['What is my jewellery worth', qa([
    ['What is my jewellery worth?', 'It depends on what you mean by worth. Replacement value (for insurance), fair market value (for selling or an estate) and scrap value (the metal and stones alone) are three different numbers for the same piece. Tell us what you need the value for and we will appraise on that basis.'],
    ['Why is the appraised value higher than what I could sell it for?', 'An insurance appraisal states retail replacement value — the cost to buy an equivalent piece new. Resale is a different market with a different, usually lower, price. Neither number is wrong; they answer different questions.'],
    ['Can you tell me what it is worth over the phone or from a photo?', 'Not reliably. Value depends on things a photo cannot show — clarity, colour, treatments, whether a stone is natural or lab-grown, the metal\'s purity. Send a photo and we will tell you what an appraisal would involve, then examine it in person.'],
    ['Is my diamond real?', 'We test every stone we appraise. Diamond, moissanite, cubic zirconia and lab-grown diamond can look identical to the eye and are told apart with instruments — bring it in and we will tell you.'],
    ['Is my gold real, and what karat is it?', 'We test the metal as part of an appraisal and state its purity on the document. A hallmark helps but hallmarks can be wrong or missing, so we test.'],
    ['How much is my gold worth as scrap?', 'Scrap value is the weight of the pure gold at today\'s market price, less the refiner\'s margin. It ignores the stones and the work. We can tell you the metal weight and purity; the scrap figure moves daily with the gold price.'],
    ['Does an old appraisal still show what my piece is worth?', 'Values change. Gold and diamond prices move, and an appraisal more than a few years old is usually out of date. Bring it along — it helps — and we will issue a current one.'],
    ['Will you tell me if a piece is not worth appraising?', 'Yes. If the fee would be out of proportion to the value, we say so before you pay.'],
  ])],

  ['Purchase verification', qa([
    ['Can you verify a piece I am about to buy?', 'Yes. A purchase verification checks that the piece is what it is described as: the stone\'s identity, whether it is natural or lab-grown, its grades, the metal\'s purity, and whether it matches any certificate supplied.'],
    ['Can you check a diamond against its GIA report?', 'Yes. We compare the stone\'s measurements, weight, inscription (if it has one) and characteristics to the report and tell you whether they match.'],
    ['I bought a diamond that came with a certificate — should I still have it checked?', 'Reports describe a stone, not a piece of jewellery; and a stone can be swapped or a report can belong to a different stone. A verification confirms the stone you hold is the one on the paper.'],
    ['Can you tell whether a diamond is lab-grown?', 'Yes, with laboratory testing. Lab-grown and natural diamonds are chemically the same and cannot be told apart by eye or by a jeweller\'s loupe. Our equipment identifies them.'],
    ['Can you tell whether a gemstone has been treated?', 'Many gemstones are routinely treated — heated, filled, irradiated — and this affects value. We identify the treatments we can detect with our instruments and state them; some treatments require a major gem laboratory to confirm, and we will tell you when that is the case.'],
    ['I think I overpaid — can you tell me?', 'We can tell you what the piece is and what it would appraise at. Whether the price was fair is your judgment with that information.'],
    ['Can you do a verification while I wait?', 'Sometimes, for a single simple piece — ask when booking. Most appraisals take longer because the written report is part of the service.'],
    ['Do you verify watches?', 'We can describe and value a watch and note obvious issues, but authentication of a luxury watch\'s movement and serial numbers is a specialist service. Ask us and we will say what we can do for your watch.'],
  ])],

  ['Selling jewellery', qa([
    ['I want to sell my jewellery — do I need an appraisal first?', 'It helps. An appraisal on a fair-market basis tells you what the piece is and gives you a realistic figure, so you can judge offers. An insurance appraisal will NOT tell you what you can sell it for.'],
    ['Do you buy jewellery?', 'Our appraisal service is independent of buying. Ask us and we will explain your options and where to sell different kinds of pieces.'],
    ['What is the difference between appraised value and an offer to buy?', 'A buyer pays what they can resell it for, less their margin. Expect offers well below retail replacement value, and somewhat below fair market value.'],
    ['Where can I sell a diamond ring?', 'Options include consignment with a jeweller, a specialist diamond buyer, auction, or a private sale. Each has different speed and price. An appraisal lets you compare offers on the same basis.'],
    ['Should I sell the stone and the setting separately?', 'Sometimes. A good stone in an unfashionable setting is often worth more on its own, and the metal as scrap. We can tell you the stone\'s value and the metal value separately.'],
    ['Can you give me a certificate to help sell my diamond?', 'We can appraise the stone and describe it. For a diamond above about half a carat, a report from a major laboratory (such as GIA) is what buyers expect, and we can advise on submitting it.'],
  ])],

  ['Booking an appointment', qa([
    ['How do I book an appraisal?', 'Book online or contact us with the number of pieces and what the appraisal is for (insurance, estate, sale, verification). We confirm a time and tell you what to bring.'],
    ['Do I need an appointment?', 'Yes — appraisals are by appointment so the gemmologist has the time and the equipment ready for your piece.'],
    ['How long does an appraisal take?', 'Examining a single piece usually takes about half an hour; the written report follows. For several pieces or a collection, allow longer and ask when booking.'],
    ['Do I leave my jewellery with you?', 'For most appraisals the piece stays with us while the report is prepared and you collect it with the document. If you prefer to wait with a single piece, ask when booking and we will try to arrange it.'],
    ['Is my jewellery safe with you?', 'Yes. Pieces are logged in with a description and photograph when received, kept secured, and released only to you with the report.'],
    ['What should I bring?', 'The piece, and anything that came with it: receipts, certificates or lab reports, earlier appraisals, the original box. Do not clean or polish a piece you are unsure about.'],
    ['Can you come to me?', 'For larger estates or collections we may arrange a visit; ask us. Individual pieces are appraised at our lab where the equipment is.'],
    ['Where are you and what are your hours?', 'See our location and hours in the business details. Appointments outside regular hours may be possible on request.'],
    ['Can I get a rush appraisal?', 'Often, for a single piece — ask when booking and we will tell you the earliest we can deliver.'],
  ])],

  ['What an appraisal contains and how it is done', qa([
    ['What does the appraisal document include?', 'A full description of the piece: type, metal and purity, weights and measurements, each stone\'s identity, shape, measurements, estimated weight, colour and clarity grades, any treatments detected, condition, photographs, the value and its basis, the date, and the appraiser\'s credentials and signature.'],
    ['Who does the appraisal?', 'A qualified gemmologist. The appraiser\'s qualifications are stated on the document.'],
    ['Do you remove stones to weigh them?', 'No. Stones set in jewellery are measured and their weight is estimated from measurements and known formulas; the document says "estimated" where that is the case. Removing a stone risks damage and is only done at the customer\'s request for a specific reason.'],
    ['What equipment do you use?', 'Standard gemmological instruments — microscope, refractometer, spectroscope, diamond and moissanite testers, scales, UV, and equipment for screening lab-grown diamonds — plus reference materials for grading.'],
    ['Do you grade diamonds the same way GIA does?', 'We grade using the same scales (D–Z colour, Flawless–I3 clarity, cut grades) and standard methods. A laboratory report and an appraisal are different documents: the lab grades an unmounted stone under laboratory conditions; an appraisal describes and values the piece as it is.'],
    ['Will you clean my jewellery?', 'We clean pieces as needed to examine them properly, using methods safe for the stones. Tell us if a piece is fragile or has been repaired.'],
    ['Do I get a copy, and can I get another later?', 'You receive the signed appraisal. We keep a record and can issue a copy or an update later.'],
    ['Is the appraisal confidential?', 'Yes. We do not share your appraisal or your details with anyone but you, unless you ask us to send it to your insurer or lawyer.'],
  ])],

  ['Diamonds', qa([
    ['What are the 4Cs?', 'Cut, colour, clarity and carat weight — the four factors used to describe and value a diamond. Cut is how well it is proportioned and finished; colour runs from D (colourless) to Z; clarity from Flawless to Included; carat is weight.'],
    ['What is the difference between carat and karat?', 'Carat (ct) is the weight of a stone; karat (K) is the purity of gold. 1 carat is 0.2 grams; 18K gold is 75% pure.'],
    ['Does a bigger diamond always cost more?', 'Weight matters, but a larger stone of poor colour, clarity or cut can be worth less than a smaller, finer one. Value is all four Cs together, and prices step up at popular weights such as 1.00 carat.'],
    ['What is a laser inscription?', 'Many laboratory-graded diamonds have the report number inscribed on the girdle, visible under magnification. It lets us match the stone to its report.'],
    ['What is fluorescence?', 'Some diamonds glow under ultraviolet light. Faint to medium fluorescence rarely affects appearance; strong fluorescence can, and it is noted on the appraisal.'],
    ['Are lab-grown diamonds worth less?', 'Lab-grown diamonds sell for much less than natural diamonds of the same grades and their resale market is limited. An appraisal states clearly whether a stone is natural or lab-grown and values it accordingly.'],
    ['Can a chipped diamond be appraised?', 'Yes. Damage is described and reflected in the value. We can also tell you whether recutting is worthwhile.'],
  ])],

  ['Coloured gemstones and pearls', qa([
    ['Can you appraise coloured gemstones?', 'Yes — sapphire, ruby, emerald, and the full range of coloured stones. We identify the stone, detect treatments where our instruments allow, and value it.'],
    ['Are emeralds usually treated?', 'Almost all emeralds are treated with oil or resin to improve clarity; this is normal and disclosed. The degree of treatment affects value and is noted where we can determine it.'],
    ['Are sapphires and rubies heated?', 'Most are. Heating is a standard, accepted treatment. Unheated stones with laboratory reports command a premium. We state what we can detect and recommend a laboratory report for an important stone.'],
    ['Can you tell natural sapphire from synthetic?', 'Usually, with microscopy and instruments. Some synthetics require advanced laboratory testing; we will tell you if a stone needs to go further.'],
    ['Do you appraise pearls?', 'Yes. We identify natural, cultured and imitation pearls, note type (Akoya, South Sea, Tahitian, freshwater), size, shape, lustre, surface and matching, and value the strand or piece.'],
    ['Can you appraise opal, jade or turquoise?', 'Yes, and each has its own concerns — opal stability, jade treatments, turquoise stabilisation — which we assess and note.'],
    ['What is the difference between a gemstone report and an appraisal?', 'A report identifies and describes a stone (often from a major laboratory); an appraisal describes the piece and states a value. We can provide the appraisal and advise when a laboratory report is worth obtaining.'],
  ])],

  ['Watches', qa([
    ['Do you appraise watches?', 'Yes. Watch appraisals are more involved than jewellery — see Appraisal pricing for the range — and cover the case, movement (as far as can be seen without opening the case), dial, bracelet, and condition.'],
    ['Can you authenticate a Rolex or other luxury watch?', 'We can examine and describe the watch and note anything inconsistent, but full authentication of a luxury watch is a specialist service that may involve opening the case. Ask us and we will say what we can do for your watch.'],
    ['Do you open the watch case?', 'Not routinely. Opening a case should be done by a watchmaker; we appraise what can be seen and say so on the document.'],
    ['Do you appraise vintage or antique watches?', 'Yes. Age, originality of parts, condition and provenance all matter and are described.'],
    ['What should I bring with a watch?', 'The watch, its box, papers, warranty card, service records and any receipts. Papers matter a great deal to a watch\'s value.'],
  ])],

  ['Antique and estate pieces', qa([
    ['Do you appraise antique jewellery?', 'Yes. Antique and period pieces (Victorian, Edwardian, Art Deco, mid-century) are appraised with attention to age, construction, originality, hallmarks and maker where identifiable. See Appraisal pricing for the range.'],
    ['How do you value an antique piece?', 'On the basis you need — replacement for insurance, or fair market for sale or estate — taking into account the piece\'s age, quality, condition, rarity and current demand for the period, not only its stones and metal.'],
    ['Can you identify the maker or the period?', 'Often, from hallmarks, construction and style. Where we are not certain we say so rather than guess.'],
    ['My piece has old-cut diamonds — are they worth less?', 'Old European and old mine cuts are valued differently from modern brilliants; demand for good old cuts is strong. We describe the cut and value accordingly rather than treating it as a poorly cut modern stone.'],
    ['Should I have an antique piece repaired before appraisal?', 'No. Appraise first; some repairs reduce an antique\'s value and we can advise what is worth doing.'],
    ['Do you appraise costume jewellery?', 'We can, and signed vintage costume pieces have a collector market. For unsigned costume jewellery the fee may exceed the value, and we will tell you so.'],
  ])],

  ['Repairs, cleaning and care questions the lab gets asked', qa([
    ['Do you do repairs?', 'We are an appraisal lab. We can tell you what a piece needs and refer you to a jeweller; if you came to us through a jeweller, they can quote the repair.'],
    ['Will an appraisal say whether my ring needs repair?', 'Yes. Condition is part of the appraisal — worn prongs, thin shanks, loose stones, cracks — and we note anything that should be attended to.'],
    ['How should I clean my jewellery at home?', 'Warm water with a drop of dish soap and a soft brush is safe for most gold and diamond pieces. Avoid ultrasonic cleaners for emeralds, opals, pearls and any stone with fractures, and avoid bleach and chlorine on gold.'],
    ['How should I store jewellery?', 'Separately, so pieces do not scratch each other — diamonds scratch everything, including other diamonds. Pearls away from perfume and hairspray; opals away from heat and dryness.'],
    ['How often should prongs be checked?', 'About once a year for rings worn daily. A loose stone is far cheaper to prevent than to replace.'],
    ['Can I get my appraisal engraved or inscribed on the piece?', 'No — an appraisal is a document. A laser inscription of a lab report number on a diamond is something a laboratory does when it grades the stone.'],
  ])],
]

// ── RUN ─────────────────────────────────────────────────────────────────────────────────────────
const [agent] = await (await rest(`ai_employees?select=id,tenant_id,name,business_name&id=eq.${agentId}`)).json()
if (!agent) { console.error('No such AI employee'); process.exit(1) }
console.log(`Seeding appraisal knowledge for ${agent.name} (${agent.business_name || 'no business name'}) on tenant ${agent.tenant_id.slice(0, 8)}…`)

const existing = await (await rest(`knowledge_base?select=id,title&tenant_id=eq.${agent.tenant_id}&ai_employee_id=eq.${agentId}`)).json()
const byTitle = new Map(existing.map((r) => [r.title, r.id]))
let created = 0, skipped = 0, replaced = 0, pairs = 0
for (const [title, content] of ENTRIES) {
  pairs += (content.match(/^Q: /gm) || []).length
  if (byTitle.has(title)) {
    if (!replace) { skipped++; continue }
    await rest(`knowledge_base?id=eq.${byTitle.get(title)}`, { method: 'DELETE' })
    replaced++
  }
  const r = await rest('knowledge_base', { method: 'POST', body: JSON.stringify({ tenant_id: agent.tenant_id, ai_employee_id: agentId, origin_ai_employee_id: agentId, title, content, source: 'template' }) })
  if (!r.ok) { console.error('insert failed', title, await r.text()); process.exit(1) }
  created++
}
console.log(`Done: ${created} entries written (${replaced} replaced, ${skipped} skipped), ${pairs} Q&A pairs in the seed.`)
