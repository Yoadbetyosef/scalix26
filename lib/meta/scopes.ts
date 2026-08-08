// The Facebook permissions this integration depends on.
//
// ── READ THIS FIRST: THIS LIST IS NO LONGER SENT ────────────────────────────────────────────────────
//
// It was, until the app moved to Facebook Login for Business. Under that flow the dialog is driven by
// a CONFIGURATION created in the Meta dashboard, and Meta's documentation is explicit that "config_id
// has replaced scope (which should not be used)". So the permissions below are held by Meta, in
// configuration `META_CONFIG_ID`, and nothing in this repository transmits them.
//
// ── WHICH MAKES THIS FILE A HAZARD, AND IT IS NAMED HERE ON PURPOSE ─────────────────────────────────
//
// OUTSTANDING.md §7j: a comment asserting two things are in sync is a claim nothing checks. This file
// is now exactly that shape — a list in the codebase describing a value in someone else's dashboard,
// with no mechanism able to compare them. Somebody can edit the Meta configuration tomorrow and every
// word here stays confidently wrong.
//
// The rule says to make them one thing rather than to correct the comment, and that is NOT possible
// here: the dashboard is authoritative and unreadable from code. So the honest options were to delete
// this file or to keep it while saying plainly what it is. It is kept, because the alternative is that
// the permissions this integration needs exist in no readable place at all — a person debugging a
// missing message needs to know that `pages_manage_metadata` is what subscribes the webhook.
//
// TREAT AS DOCUMENTATION, NOT CONFIGURATION. If it disagrees with the dashboard, the dashboard wins
// and this file is the thing that is wrong.
//
// ── THE CONFIGURATION AS CREATED (7 Aug 2026) ───────────────────────────────────────────────────────
//
//   Name        Scalix26 Production
//   Token type  System-user, expiration NEVER
//   Assets      Pages (required), Instagram accounts (OPTIONAL)
//
// Both choices are deliberate and worth preserving on any future configuration:
//
//   Never-expiring — a 60-day token dies in the middle of a Tuesday and takes the tenant's Messenger
//   integration with it. Nothing here polls token health, so neither the tenant nor we would learn
//   about it until a customer's message went unanswered. That is the same silent-failure shape as
//   everything else logged in OUTSTANDING §0.
//
//   Instagram OPTIONAL — a business with a Facebook Page and no Instagram business account can still
//   connect Messenger. Marking it required would block that tenant entirely at the dialog, for a
//   channel they were not asking for.

/** What the Meta configuration grants. NOT sent — see the header. */
export const META_SCOPES = [
  // GET /me/accounts — list the Pages, and read each Page access token.
  'pages_show_list',

  // POST /{page-id}/subscribed_apps — subscribe the app to the Page's `messages` and
  // `messaging_postbacks` webhooks. Without it inbound messages never arrive.
  'pages_manage_metadata',

  // POST /me/messages with a Page token — send and receive Messenger conversations.
  'pages_messaging',

  // GET /me/accounts?fields=…instagram_business_account{…} — resolve the IG Business account attached
  // to a Page. The Messenger-API-for-Instagram shape, which is why no Instagram Login product is used.
  'instagram_basic',

  // Send and receive Instagram DMs. NOT instagram_business_manage_messages, which belongs to the
  // Instagram Login product this app does not implement.
  'instagram_manage_messages',
] as const

// ── DELIBERATELY ABSENT ─────────────────────────────────────────────────────────────────────────────
//
// pages_read_engagement — Page insights and content reads. Nothing here reads either.
// business_management  — Business Manager assets. Nothing here touches them, and it is one of Meta's
//                        most restricted permissions.
//
// Both were requested by the old scope-based dialog for months and neither was ever submitted for
// review. Do not add them to the Meta configuration "to be safe" — on this API surface, asking for
// more than you were granted is the failure, not the safety margin.
