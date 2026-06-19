// Derive a target US area code so a newly provisioned number matches the customer's
// region instead of being random. Pure functions; no I/O. Fail-safe by design — any
// "can't tell" case returns null and the caller falls back to any-local search.

// Extract a plausible NANP area code from a free-form phone string. Handles
// +1XXXXXXXXXX, 1XXXXXXXXXX, (XXX) XXX-XXXX, XXX-XXX-XXXX, etc.
export function parseAreaCode(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = String(phone).replace(/\D/g, '')
  let area: string | null = null
  if (digits.length === 11 && digits.startsWith('1')) area = digits.slice(1, 4)
  else if (digits.length === 10) area = digits.slice(0, 3)
  else if (digits.length > 11 && digits.startsWith('1')) area = digits.slice(1, 4)
  // NANP area code: first digit 2-9, then two more digits.
  return area && /^[2-9]\d{2}$/.test(area) ? area : null
}

// One representative, valid in-state area code per US state. Used ONLY when no usable
// business phone exists — a reliable regional match, far better than a random number.
const STATE_AREA_CODE: Record<string, string> = {
  AL: '205', AK: '907', AZ: '602', AR: '501', CA: '213', CO: '303', CT: '203', DE: '302',
  FL: '305', GA: '404', HI: '808', ID: '208', IL: '312', IN: '317', IA: '515', KS: '316',
  KY: '502', LA: '504', ME: '207', MD: '410', MA: '617', MI: '313', MN: '612', MS: '601',
  MO: '314', MT: '406', NE: '402', NV: '702', NH: '603', NJ: '201', NM: '505', NY: '212',
  NC: '704', ND: '701', OH: '614', OK: '405', OR: '503', PA: '215', RI: '401', SC: '803',
  SD: '605', TN: '615', TX: '214', UT: '801', VT: '802', VA: '804', WA: '206', WV: '304',
  WI: '414', WY: '307', DC: '202',
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
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
}

function areaCodeForState(state: string | null | undefined): string | null {
  if (!state) return null
  const raw = String(state).trim().toLowerCase()
  if (!raw) return null
  const abbr = raw.length === 2 ? raw.toUpperCase() : STATE_NAME_TO_ABBR[raw]
  return (abbr && STATE_AREA_CODE[abbr]) || null
}

// Fallback chain: explicit preference (future onboarding picker) → business phone
// (forward_to_phone, then tenant phone) → state → null (caller uses any-local).
export function deriveAreaCode(input: {
  preferred?: string | null
  forwardPhone?: string | null
  tenantPhone?: string | null
  state?: string | null
}): string | null {
  return (
    parseAreaCode(input.preferred) ||
    parseAreaCode(input.forwardPhone) ||
    parseAreaCode(input.tenantPhone) ||
    areaCodeForState(input.state) ||
    null
  )
}
