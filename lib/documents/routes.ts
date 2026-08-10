// Which routes are CUSTOMER-FACING documents.
//
// A document is something a tenant's own customer opens — an estimate, a quote, an invoice, an
// approval page. The platform's identity must not appear on any of them: not in the page title, not
// in the printed header, not in the injected brand.
//
// Single-sourced because three separate things need the same answer — the root layout (which brand to
// inject), the print stylesheet, and the tests that assert nothing leaks. Three copies of this list
// would be three chances for one to drift, which is how the leak reached production in the first place.

/**
 * True for a path whose audience is the TENANT'S customer rather than the tenant.
 *
 * /orders is matched only at its document sub-path: /orders/[id] itself is the owner's own screen and
 * keeps the app's chrome.
 */
export function isCustomerDocumentPath(pathname: string): boolean {
  // /f/ is the hosted lead-capture page a tenant shares with prospects. Not a document, but the same
  // audience and the same rule — it was inheriting our title too, so a prospect opening a jeweller's
  // enquiry form saw our name in the browser tab.
  if (pathname.startsWith('/d/') || pathname.startsWith('/approval/') || pathname.startsWith('/f/')) return true
  if (pathname.startsWith('/e/')) return true
  return /^\/orders\/[^/]+\/document(\/|$)/.test(pathname)
}

/** The header the middleware stamps so a server component can know the path it is rendering. */
export const PATHNAME_HEADER = 'x-pathname'

/**
 * The brand injected on a customer document: nothing.
 *
 * NOT the platform's, and not the host's. A public document page has no session, so the host is the
 * only thing the old code could fall back on — which is exactly how every white-label tenant's
 * estimate came to carry our name. The page itself renders the tenant's identity from the document's
 * own row, which is the only place that knows whose customer is reading it.
 */
export const NEUTRAL_BRAND = {
  name: '',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  secondaryColor: null,
  supportEmail: null,
  supportPhone: null,
  website: null,
  emailFooter: null,
  loginBackgroundUrl: null,
  // False, not "unset". Both flags render visible platform text elsewhere in the app — a "Powered by
  // Scalix" line in the sidebar and on the invite page — and a document must be able to inherit
  // neither by accident.
  poweredByScalix: false,
  isPartnerBrand: false,
}
