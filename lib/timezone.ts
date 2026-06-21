import { parseAreaCode } from '@/lib/twilio/area-code'
import { createAdminClient } from '@/lib/supabase/server'

export const DEFAULT_TIMEZONE = 'America/New_York'

// Is a string a real IANA timezone the runtime accepts?
export function isValidIanaTz(tz?: string | null): boolean {
  if (!tz || typeof tz !== 'string') return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

// NANP area code → IANA US/CA timezone. Best-effort FALLBACK only (browser tz is the
// primary source). Built from grouped arrays for maintainability.
const AREA_CODE_TZ: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  const add = (tz: string, codes: number[]) => { for (const c of codes) m[String(c)] = tz }
  add('America/Los_Angeles', [206, 253, 360, 425, 564, 503, 541, 971, 458, 209, 213, 279, 310, 323, 408, 415, 424, 442, 510, 530, 559, 562, 619, 626, 628, 650, 657, 661, 669, 707, 714, 747, 760, 805, 818, 820, 831, 840, 858, 909, 916, 925, 949, 951, 702, 725, 775])
  add('America/Vancouver', [604, 778, 236, 672, 250]) // BC
  add('America/Phoenix', [480, 520, 602, 623, 928]) // AZ (no DST)
  add('America/Denver', [303, 719, 720, 970, 983, 208, 986, 406, 505, 575, 385, 801, 307])
  add('America/Chicago', [205, 251, 256, 334, 659, 479, 501, 870, 217, 224, 309, 312, 331, 447, 464, 618, 630, 708, 773, 779, 815, 847, 872, 319, 515, 563, 641, 712, 316, 620, 785, 225, 318, 337, 504, 985, 218, 320, 507, 612, 651, 763, 952, 228, 601, 662, 769, 314, 417, 573, 636, 660, 816, 308, 402, 531, 701, 405, 539, 580, 918, 605, 423, 615, 629, 731, 901, 931, 210, 214, 254, 281, 325, 346, 361, 409, 430, 432, 469, 512, 682, 713, 726, 737, 806, 817, 830, 832, 903, 915, 936, 940, 945, 956, 972, 979, 262, 414, 534, 608, 715, 920])
  add('America/New_York', [203, 475, 860, 959, 302, 202, 239, 305, 321, 352, 386, 407, 561, 689, 727, 754, 772, 786, 813, 850, 863, 904, 941, 954, 229, 404, 470, 478, 678, 706, 762, 770, 912, 207, 240, 301, 410, 443, 667, 339, 351, 413, 508, 617, 774, 781, 857, 978, 231, 248, 269, 313, 517, 586, 616, 679, 734, 810, 906, 947, 989, 201, 551, 609, 640, 732, 848, 856, 862, 908, 973, 212, 315, 332, 347, 516, 518, 585, 607, 631, 646, 716, 718, 838, 845, 914, 917, 929, 934, 252, 336, 704, 743, 828, 910, 919, 980, 984, 216, 220, 234, 330, 380, 419, 440, 513, 567, 614, 740, 937, 215, 223, 267, 272, 412, 445, 484, 570, 610, 717, 724, 814, 878, 401, 803, 843, 854, 864, 276, 434, 540, 571, 703, 757, 804, 826, 304, 681])
  return m
})()

// US state / province → IANA timezone (predominant zone). Secondary fallback.
const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu', ID: 'America/Denver',
  IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago', KS: 'America/Chicago',
  KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York', MD: 'America/New_York',
  MA: 'America/New_York', MI: 'America/New_York', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago', NV: 'America/Los_Angeles',
  NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver', NY: 'America/New_York',
  NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York', OK: 'America/Chicago',
  OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', UT: 'America/Denver',
  VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles', WV: 'America/New_York',
  WI: 'America/Chicago', WY: 'America/Denver', DC: 'America/New_York',
}
const PROVINCE_TZ: Record<string, string> = {
  'british columbia': 'America/Vancouver', 'alberta': 'America/Edmonton', 'ontario': 'America/Toronto',
  'quebec': 'America/Toronto', 'manitoba': 'America/Winnipeg', 'nova scotia': 'America/Halifax',
}
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
}

function tzFromState(state?: string | null): string | null {
  if (!state) return null
  const raw = state.trim().toLowerCase()
  if (!raw) return null
  if (PROVINCE_TZ[raw]) return PROVINCE_TZ[raw]
  const abbr = raw.length === 2 ? raw.toUpperCase() : STATE_NAME_TO_ABBR[raw]
  return (abbr && STATE_TZ[abbr]) || null
}

export function tzFromAreaCode(area: string | null): string | null {
  return (area && AREA_CODE_TZ[area]) || null
}

// Resolve a business timezone: browser tz (primary) → area code → state → default.
export function resolveTimezone(input: { browserTz?: string | null; phone?: string | null; state?: string | null; fallback?: string }): string {
  if (isValidIanaTz(input.browserTz)) return input.browserTz!.trim()
  const fromArea = tzFromAreaCode(parseAreaCode(input.phone))
  if (fromArea) return fromArea
  const fromState = tzFromState(input.state)
  if (fromState) return fromState
  return input.fallback || DEFAULT_TIMEZONE
}

// Runtime business-tz lookup for the availability/booking routes. Uses the tenant's
// primary (earliest active) agent timezone, then the passed tenant timezone, then the
// default. Fail-safe: any error → default (never crash availability). Reads with its
// own admin client (these are public routes scoped to the resolved tenant).
export async function getBusinessTimezone(tenantId: string, tenantTimezone?: string | null): Promise<string> {
  try {
    const { data: agent } = await createAdminClient()
      .from('ai_employees').select('timezone').eq('tenant_id', tenantId).eq('status', 'active')
      .order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (isValidIanaTz(agent?.timezone)) return agent!.timezone as string
  } catch { /* fall through */ }
  if (isValidIanaTz(tenantTimezone)) return tenantTimezone as string
  return DEFAULT_TIMEZONE
}
