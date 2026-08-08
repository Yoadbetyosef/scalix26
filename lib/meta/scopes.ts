// The Facebook Login permissions this app asks for. ONE list, imported by every route that starts an
// OAuth dialog.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────────
//
// It was two hardcoded arrays — the production connect route and the admin App Review demo — kept in
// step by a comment saying "the SAME scopes". Both then asked for seven permissions after only five
// were submitted to Meta, and stayed that way because nothing failed at build or test time. A tenant
// hit it instead: on a Live app, a permission that has not passed App Review can still be granted to
// someone holding a ROLE on the app and is refused for everyone else, so it worked for the developer
// and not for the business owner.
//
// A comment asserting that two lists match is not a mechanism for making them match.
//
// ── THE RULE FOR CHANGING THIS ──────────────────────────────────────────────────────────────────────
//
// This list must be a SUBSET of what is approved in Meta → App Review → Permissions and Features.
// Asking for something unapproved does not degrade gracefully; it blocks the whole dialog for ordinary
// users. So: submit first, approve, then add here. Never the other way round.
//
// Each entry below names the call that needs it. If a permission has no call beside it, it does not
// belong in the list.

export const META_SCOPES = [
  // GET /me/accounts — list the Pages this user administers, and read each Page access token.
  'pages_show_list',

  // POST /{page-id}/subscribed_apps — subscribe this app to the Page's `messages` and
  // `messaging_postbacks` webhooks. Without it inbound messages never reach us.
  'pages_manage_metadata',

  // POST /me/messages with a Page token — send and receive Messenger conversations.
  'pages_messaging',

  // GET /me/accounts?fields=…instagram_business_account{…} — resolve the IG Business account
  // attached to a Page. This is the Messenger-API-for-Instagram shape, which is why the app needs no
  // Instagram Login product.
  'instagram_basic',

  // Send and receive Instagram DMs. NOT instagram_business_manage_messages, which belongs to the
  // Instagram Login product this app does not implement.
  'instagram_manage_messages',
] as const

/** Ready for the `scope` query parameter of the OAuth dialog. */
export const metaScopeParam = (): string => META_SCOPES.join(',')

// ── DELIBERATELY ABSENT ─────────────────────────────────────────────────────────────────────────────
//
// pages_read_engagement — Page insights and content reads. Nothing here reads either.
// business_management  — Business Manager assets. Nothing here touches them, and it is one of Meta's
//                        most restricted permissions, so asking for it unapproved is the single most
//                        likely thing to block a dialog.
//
// Both were requested for months and neither was ever submitted. Do not re-add them to "be safe" —
// on this API surface, asking for more than you were granted is the failure, not the safety margin.
