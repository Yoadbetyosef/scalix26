# Hardcoded platform name — audience audit

176 occurrences of "Scalix" outside `app/(v2)/`, each classified by WHO READS IT.

| audience | count | meaning |
|---|---|---|
| **CUSTOMER** | **2** | a tenant's own customer can see it — a white-label breach |
| TENANT | 32 | our customer sees it; wrong for a white-label tenant, harmless otherwise |
| INTERNAL | 142 | us, our partners, or an AI system prompt — correct as written |

## What this classification is for

The leak fixed in this branch was a CUSTOMER-audience string that nobody had classified. The point of
writing the distinction down is that the next person does not have to re-derive it, and that a new
occurrence can be triaged by asking one question: **who reads this?**

- **CUSTOMER** — must never name the platform. Enforced by `lib/documents/no-platform-branding.test.ts`.
- **TENANT** — should follow the white-label brand. Wrong today for the 5 tenants with a
  `white_label_partner_id`; not urgent, because our customer knowing our name is not a breach.
- **INTERNAL** — leave alone. Renaming these buys nothing and breaks partner-facing copy.

## Worth revisiting, in this order

1. `lib/email/send.ts` — `FROM = 'Scalix <…>'` is still the default display name for any send that
   does not pass `fromName`. `customerFacing()` now throws rather than falling back silently, but
   nothing forces a new caller to use it.
2. `app/auth/signup/page.tsx` — the SMS consent line names Scalix26 LLC. A white-label tenant's signup
   should name the partner's entity. A legal question before a code one.
3. `lib/partner/demo.ts`, `lib/partner/marketing-ai.ts` — system prompts asserting the model IS
   Scalix26. Correct for our demo; wrong if a partner runs one under their own brand.

## The full list

| audience | file | line | text |
|---|---|---|---|
| **CUSTOMER** | `app/api/studio/documents/[id]/send/route.ts` | 44 | // Branded as the tenant. Without this the customer's inbox shows "Scalix" as the sen… |
| **CUSTOMER** | `app/f/[slug]/page.tsx` | 42 | <p className="text-center text-xs text-muted mt-4">Powered by Scalix</p> |
| TENANT | `app/auth/signup/page.tsx` | 173 | I agree to receive SMS messages from Scalix26 LLC at the mobile number provided above, |
| TENANT | `app/invite/[token]/page.tsx` | 10 | // Override the root layout's (host = Scalix) metadata so the browser tab + favicon a… |
| TENANT | `app/invite/[token]/page.tsx` | 11 | // brand — the invited customer must never see "Scalix" anywhere, including the tab t… |
| TENANT | `app/invite/[token]/page.tsx` | 40 | {brand?.poweredByScalix && <p className="mt-4 text-center text-[11px] text-muted">Pow… |
| TENANT | `app/invite/[token]/page.tsx` | 45 | // Invalid / used / revoked / expired — clean branded message, no Scalix. |
| TENANT | `app/settings/page.tsx` | 21 | // In operator mode the Scalix billing/subscription section is hidden — a White Label… |
| TENANT | `app/settings/page.tsx` | 22 | // governed by the partner, never Scalix Stripe. (Owner mode is unchanged for normal … |
| TENANT | `components/dashboard/attention-needed.tsx` | 21 | const brandName = useBrand()?.name \|\| 'Scalix' |
| TENANT | `components/dashboard/drill-down-drawer.tsx` | 59 | const brandName = useBrand()?.name \|\| 'Scalix' |
| TENANT | `components/dashboard/drill-down-drawer.tsx` | 101 | const brandName = useBrand()?.name \|\| 'Scalix' |
| TENANT | `components/dashboard/impact-dashboard.tsx` | 60 | // Brand-aware: operator mode → the White Label partner's brand; otherwise Scalix/hos… |
| TENANT | `components/dashboard/impact-dashboard.tsx` | 61 | const brandName = useBrand()?.name \|\| 'Scalix' |
| TENANT | `components/dashboard/sidebar.tsx` | 30 | import { ScalixLogo } from '@/components/brand/scalix-logo' |
| TENANT | `components/dashboard/sidebar.tsx` | 54 | // in a White Label operator's client workspace — the FULL product minus Scalix billi… |
| TENANT | `components/dashboard/sidebar.tsx` | 55 | // Subscription" is intentionally excluded (a client's plan is governed by the partne… |
| TENANT | `components/dashboard/sidebar.tsx` | 61 | // hides Partner Program, Admin, and Scalix billing. `operator` additionally drives t… |
| TENANT | `components/dashboard/sidebar.tsx` | 93 | // plan/trial (no Scalix billing inside a client workspace). |
| TENANT | `components/dashboard/sidebar.tsx` | 117 | // Resolve the host-based brand (myLocksmith / Scalix26 / default) once on mount. |
| TENANT | `components/dashboard/sidebar.tsx` | 143 | // Scalix billing — a client's plan is governed by the partner. All product routes ar… |
| TENANT | `components/dashboard/sidebar.tsx` | 158 | {/* Logo — partner brand on their domain, Scalix otherwise. flex-shrink-0: header sta… |
| TENANT | `components/dashboard/sidebar.tsx` | 162 | : <ScalixLogo size={26} className="flex-shrink-0" />} |
| TENANT | `components/dashboard/sidebar.tsx` | 196 | {/* Trial / plan status — Scalix billing, hidden across the whole White Label plane. */} |
| TENANT | `components/dashboard/sidebar.tsx` | 234 | {pb?.isPartnerBrand && pb.poweredByScalix && <div className="hidden xl:block px-3 pt-… |
| TENANT | `components/dashboard/weekly-win.tsx` | 23 | const brandName = useBrand()?.name \|\| 'Scalix' |
| TENANT | `lib/email/send.ts` | 12 | const FROM = `Scalix <${FROM_ADDRESS}>` |
| TENANT | `lib/email/send.ts` | 111 | <p>Thank you for using Scalix!</p>`, |
| TENANT | `lib/email/send.ts` | 130 | <p>Your Scalix subscription has been cancelled. We're sorry to see you go.</p> |
| TENANT | `lib/email/send.ts` | 172 | subject: `You're invited to join ${company} on Scalix26`, |
| TENANT | `lib/email/send.ts` | 174 | <p>You've been invited to join <strong>${company}</strong> as <strong>${role}</strong… |
| TENANT | `lib/email/send.ts` | 189 | <p>We've issued a payout of <strong>${(amount / 100).toLocaleString('en-US', { style:… |
| TENANT | `lib/email/send.ts` | 202 | subject: 'Your Scalix balance is running low', |
| TENANT | `lib/email/send.ts` | 209 | subject: 'Action needed: your Scalix balance is empty', |
| INTERNAL | `app/admin/command-center/layout.tsx` | 16 | <p className="text-sm text-subtle">Mission control for Scalix26 — founder-confidentia… |
| INTERNAL | `app/admin/command-center/support-ops/page.tsx` | 23 | // signal and are shown separately, NOT counted as Scalix support demand. |
| INTERNAL | `app/api/admin/users/[id]/route.ts` | 56 | const result = await sendEmail(tenant.email, 'Reset your Scalix password', |
| INTERNAL | `app/api/ai/amy/realtime-auth/route.ts` | 10 | // Inert for direct Scalix tenants and while WL_BILLING_ENABLED is off (gate passes →… |
| INTERNAL | `app/api/ai/amy/route.ts` | 18 | // owning partner can't run it. Inert for direct Scalix tenants and while WL_BILLING_… |
| INTERNAL | `app/api/auth/forgot-password/route.ts` | 15 | <div style="font-size:14px;font-weight:600;color:#374151">Scalix</div> |
| INTERNAL | `app/api/auth/forgot-password/route.ts` | 17 | <p style="font-size:14px;color:#4b5563;margin:0 0 16px">We received a request to rese… |
| INTERNAL | `app/api/auth/forgot-password/route.ts` | 43 | await sendEmail(email, 'Reset your Scalix password', resetEmailHtml(link)) |
| INTERNAL | `app/api/brain/run/[agentId]/route.ts` | 20 | // Scalix tenants and while WL_BILLING_ENABLED is off. |
| INTERNAL | `app/api/partner/coach/email/route.ts` | 20 | system: 'You are an expert B2B sales copywriter for Scalix26, an AI employee that ans… |
| INTERNAL | `app/api/partner/coach/email/route.ts` | 21 | messages: [{ role: 'user', content: `Write ${kind} to ${target}. Emphasize how many l… |
| INTERNAL | `app/api/partner/creatives/route.ts` | 9 | // Returns the partner's own creatives + the official Scalix library (partner_id NULL). |
| INTERNAL | `app/api/partner/members/route.ts` | 45 | const tmpl = emailTemplates.partnerInvite(ctx.companyName \|\| 'a Scalix26 partner', r,… |
| INTERNAL | `app/api/webhooks/twilio/voice/route.ts` | 114 | // a realtime stream. Covers the first turn and every gather turn. No-op for direct S… |
| INTERNAL | `app/api/webhooks/twilio/voice/status/route.ts` | 41 | // meterUsage resolves the owning WL partner + snapshots pricing; direct Scalix tenan… |
| INTERNAL | `app/demo/[slug]/page.tsx` | 8 | // Public, branded, interactive preview of a Scalix26 AI employee for a specific pros… |
| INTERNAL | `app/demo/[slug]/page.tsx` | 50 | Powered by <span className="font-medium text-subtle">Scalix26</span> · This is a live… |
| INTERNAL | `app/layout.tsx` | 18 | //      what makes a White Label customer see the partner's software, not Scalix. |
| INTERNAL | `app/layout.tsx` | 20 | //   3. Default Scalix / host brand. |
| INTERNAL | `app/layout.tsx` | 49 | // Brand (name, favicon) resolved operator-first (active client's partner) → host → S… |
| INTERNAL | `app/marketplace/[slug]/page.tsx` | 40 | <div className="flex items-center gap-1 text-sm text-accent-strong"><Award className=… |
| INTERNAL | `app/marketplace/[slug]/page.tsx` | 57 | <div><div className="text-lg font-semibold text-ink">{profile.response_time \|\| (years… |
| INTERNAL | `app/marketplace/page.tsx` | 19 | <h1 className="text-3xl font-semibold tracking-tight text-ink">Find a Scalix26 Partne… |
| INTERNAL | `app/partner/(app)/infrastructure/page.tsx` | 16 | <PageHeader title="Infrastructure" subtitle="Your own Twilio, OpenAI, ElevenLabs & em… |
| INTERNAL | `app/partner/(app)/layout.tsx` | 34 | // to the neutral company accent when no brand is configured yet (never a Scalix bran… |
| INTERNAL | `app/partner/(app)/layout.tsx` | 44 | <BrandProvider brand={brand ?? { name: companyName, logoUrl: null, faviconUrl: null, … |
| INTERNAL | `app/partner/(app)/learning/page.tsx` | 12 | <PageHeader title="Academy" subtitle="Learn to sell Scalix26 and earn your Certified … |
| INTERNAL | `app/partner/signup/page.tsx` | 75 | <AuthShell brandLogo={brand.logo} headline="Become a Scalix26 partner." subheadline="… |
| INTERNAL | `app/partner/signup/page.tsx` | 94 | <AuthShell brandLogo={brand.logo} headline="Build a business on Scalix26." subheadlin… |
| INTERNAL | `components/admin/admin-nav.tsx` | 39 | <span className="mr-3 font-bold">Scalix Admin</span> |
| INTERNAL | `components/admin/meta-review-demo-client.tsx` | 17 | { perm: 'pages_messaging', use: 'Send and receive Facebook Page (Messenger) messages … |
| INTERNAL | `components/admin/meta-review-demo-client.tsx` | 19 | { perm: 'instagram_manage_messages', use: 'Send and receive Instagram Direct messages… |
| INTERNAL | `components/admin/meta-review-demo-client.tsx` | 171 | <Caption>This shows an incoming customer message inside Scalix.</Caption> |
| INTERNAL | `components/admin/meta-review-demo-client.tsx` | 175 | <Step n={3} title="Send Message From Scalix"> |
| INTERNAL | `components/admin/meta-review-demo-client.tsx` | 184 | <Caption>This sends a reply from Scalix using the Meta messaging API.</Caption> |
| INTERNAL | `components/app/app-shell.tsx` | 9 | * The Scalix authenticated shell — the continuation of the /auth world inside the app. |
| INTERNAL | `components/app/app-shell.tsx` | 18 | // Hide partner/admin/Scalix-billing surfaces for the whole White Label plane: both w… |
| INTERNAL | `components/app/app-shell.tsx` | 20 | // customer must never see "Partner Program", Admin, or Scalix billing — it's the par… |
| INTERNAL | `components/auth/auth-shell.tsx` | 12 | * The doorway into the Scalix OS. A calm two-column entrance that inherits the |
| INTERNAL | `components/brand/ai-orb.tsx` | 7 | // The default Scalix voice waveform — tallest in the middle, gradient teal → blue → … |
| INTERNAL | `components/brand/ai-orb.tsx` | 13 | // so the AI presence feels like the partner's own product. Scalix's own customers ke… |
| INTERNAL | `components/brand/scalix-logo.tsx` | 7 | export function ScalixLogo({ size = 30, className }: { size?: number; className?: str… |
| INTERNAL | `components/catalog/connect-website.tsx` | 42 | body: 'The robots.txt file on your site tells automated readers to stay out of your p… |
| INTERNAL | `components/invite/invite-accept-form.tsx` | 9 | // session with the SAME password and drop them into their own (branded) business. No… |
| INTERNAL | `components/partner/academy.tsx` | 68 | <div><div className="font-semibold text-ink">{cert.badge}</div><div className="text-s… |
| INTERNAL | `components/partner/commissions-view.tsx` | 82 | <p className="text-sm leading-relaxed text-subtle">Automatic payouts are not availabl… |
| INTERNAL | `components/partner/commissions-view.tsx` | 168 | <Prog icon={CreditCard} title="How payouts work">Payout mode is <span className="font… |
| INTERNAL | `components/partner/commissions-view.tsx` | 278 | <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><… |
| INTERNAL | `components/partner/commissions-view.tsx` | 284 | <StatCard label="Wholesale Cost" value={s && s.has_pricing ? money(s.monthly_wholesal… |
| INTERNAL | `components/partner/commissions-view.tsx` | 294 | <p className="mx-auto mt-1 max-w-md text-sm text-subtle">No price book is assigned ye… |
| INTERNAL | `components/partner/commissions-view.tsx` | 320 | <DealItem icon={Percent} label={isWL ? 'Amount owed to Scalix26' : 'Balance due'} val… |
| INTERNAL | `components/partner/commissions-view.tsx` | 324 | <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><… |
| INTERNAL | `components/partner/company-nav.tsx` | 11 | // no Scalix, no "partner", no "reseller". Header = the owner's brand; footer = the o… |
| INTERNAL | `components/partner/company-nav.tsx` | 25 | // No logo yet → a clean monogram tile in the company accent (never a Scalix mark). |
| INTERNAL | `components/partner/creative-studio.tsx` | 131 | <Panel title="Official Scalix library"> |
| INTERNAL | `components/partner/landing-builder.tsx` | 57 | <p className="text-sm text-subtle">Build Scalix-hosted pages with a live preview — no… |
| INTERNAL | `components/partner/landing-render.tsx` | 58 | <p className="mt-10 text-xs text-muted">Powered by Scalix26</p> |
| INTERNAL | `components/partner/marketing-os.tsx` | 18 | // Honest banner: what's manual vs. what Scalix attributes automatically. |
| INTERNAL | `components/partner/marketing-os.tsx` | 24 | <span className="font-medium text-ink">Manual tracking mode.</span> Ad-platform integ… |
| INTERNAL | `components/partner/marketing-os.tsx` | 83 | { n: 4, t: 'Add your ad spend', d: 'So Scalix computes CAC, ROI & payback.', tab: 'sp… |
| INTERNAL | `components/partner/marketing-os.tsx` | 253 | <EducationalEmpty icon={Megaphone} title="Run your outreach as campaigns, not guesswo… |
| INTERNAL | `components/partner/marketing-os.tsx` | 388 | <span className="font-medium text-ink">Track what you spend per channel</span> so Sca… |
| INTERNAL | `components/partner/marketing-os.tsx` | 411 | <EducationalEmpty icon={DollarSign} title="Track spend to unlock true ROI" body="Log … |
| INTERNAL | `components/partner/partner-sidebar.tsx` | 13 | import { ScalixLogo } from '@/components/brand/scalix-logo' |
| INTERNAL | `components/partner/partner-sidebar.tsx` | 91 | <ScalixLogo size={26} className="flex-shrink-0" /> |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 40 | ? 'You sell Scalix26 under your own brand. Your profit is the difference between your… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 41 | : 'You buy Scalix26 at partner pricing and resell it to clients at your own price. Yo… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 55 | <StatCard label="Pending Payments" value={s && s.has_pricing ? money(s.pending_paymen… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 75 | <p className="mx-auto max-w-md text-sm text-subtle">No price book is assigned yet. Yo… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 134 | <Bill label={isWL ? 'Amount owed to Scalix26' : 'Balance due'} value={s && s.has_pric… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 139 | <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted"><… |
| INTERNAL | `components/partner/partner-wholesale-dashboard.tsx` | 147 | <p className="text-sm leading-relaxed text-subtle">Your {isWL ? 'white-label' : 'rese… |
| INTERNAL | `components/partner/roi-calculator.tsx` | 22 | const pitch = `With ~${leadsPerWeek} leads/week at a ${money(jobValue)} average value… |
| INTERNAL | `components/partner/ui.tsx` | 5 | // Maps Coach/dashboard icon keys → Scalix icon system (no emoji anywhere in the prod… |
| INTERNAL | `components/partner/wholesale-billing.tsx` | 21 | <StatCard label="Current Balance" value={hasBalance ? money(s.monthly_wholesale_cents… |
| INTERNAL | `components/partner/wholesale-billing.tsx` | 29 | <div>Your {isWL ? 'white-label' : 'reseller'} billing is currently <span className="f… |
| INTERNAL | `components/partner/wholesale-billing.tsx` | 46 | <p className="text-sm text-subtle">Your {isWL ? 'white-label' : 'reseller'} pricing, … |
| INTERNAL | `components/partner/wholesale-branding.tsx` | 73 | <label className="mt-3 flex items-center gap-2 text-sm text-ink"><input type="checkbo… |
| INTERNAL | `components/partner/wholesale-branding.tsx` | 106 | {b.email_footer \|\| `© ${new Date().getFullYear()} ${b.company_name \|\| 'Your Company'}… |
| INTERNAL | `components/partner/wholesale-infrastructure.tsx` | 115 | <p className="text-xs text-subtle">Your credentials are encrypted and used only to ru… |
| INTERNAL | `components/settings/settings-client.tsx` | 28 | // Operator mode (a White Label partner operating a client): hide the Scalix billing/… |
| INTERNAL | `components/settings/settings-client.tsx` | 29 | // section entirely — a client's plan is governed by the partner, never Scalix Stripe. |
| INTERNAL | `components/settings/settings-client.tsx` | 184 | {/* Billing — hidden in operator mode (a White Label client never sees Scalix billing… |
| INTERNAL | `lib/anthropic/pipeline.ts` | 246 | // existing data is untouched. No-op for direct Scalix tenants and while WL_BILLING_E… |
| INTERNAL | `lib/billing/gate.test.ts` | 33 | it('passes for a direct Scalix tenant (no owning partner)', async () => { |
| INTERNAL | `lib/billing/gate.ts` | 13 | //   • Only WL-client tenants are gated. Direct Scalix tenants (no white_label_partne… |
| INTERNAL | `lib/billing/gate.ts` | 26 | /** The owning WL partner, when one was resolved (null for direct Scalix tenants). */ |
| INTERNAL | `lib/billing/gate.ts` | 87 | if (!partnerId) return PASS // direct Scalix tenant — not billed to a partner, never … |
| INTERNAL | `lib/billing/gate.ts` | 107 | // nothing about balances, vendors, or Scalix — just that the assistant is briefly un… |
| INTERNAL | `lib/billing/meter.ts` | 11 | // partner balance; direct Scalix tenants meter with partner_id NULL for COGS only. |
| INTERNAL | `lib/billing/phase6.live.test.ts` | 93 | it('direct Scalix tenant unaffected', async () => { |
| INTERNAL | `lib/brain/context/providers/unavailable.ts` | 3 | // Modules that have NO backing table in Scalix26 yet. Rather than silently omit them… |
| INTERNAL | `lib/brain/recommendations.ts` | 76 | how: 'Keep payments flowing through Scalix so the Brain can learn which jobs and chan… |
| INTERNAL | `lib/brain/understanding.ts` | 73 | out.push(build(revenue, 'operations', 'revenue_flowing', 'Payments are flowing throug… |
| INTERNAL | `lib/brands.tsx` | 2 | import { ScalixLogo } from '@/components/brand/scalix-logo' |
| INTERNAL | `lib/brands.tsx` | 31 | name: 'Scalix26', |
| INTERNAL | `lib/brands.tsx` | 36 | <ScalixLogo size={30} /> |
| INTERNAL | `lib/brands.tsx` | 37 | <span className="text-xl font-semibold uppercase tracking-[0.08em] text-[#1a1f36]">Sc… |
| INTERNAL | `lib/brands.tsx` | 44 | // is the neutral Scalix26 brand — never the locksmith brand. |
| INTERNAL | `lib/calendar/google.ts` | 3 | // "Scalix AI" app), but its grant is stored separately (connected_calendars) so |
| INTERNAL | `lib/command-center/ops-adapters.ts` | 49 | // excludes them from actionable Scalix demand. |
| INTERNAL | `lib/command-center/ops-adapters.ts` | 122 | sales_opportunities: { value: null }, // no Scalix sales-pipeline source of truth yet… |
| INTERNAL | `lib/command-center/phase3b-ops.test.ts` | 23 | it('excludes raw open conversations from actionable Scalix demand', () => { |
| INTERNAL | `lib/command-center/phase3b-ops.test.ts` | 30 | expect(s.openConversationLoad.caveat).toMatch(/NOT Scalix support demand/i) |
| INTERNAL | `lib/command-center/support-ops.ts` | 7 | // PRODUCT-USAGE signal and are deliberately EXCLUDED from Scalix's actionable suppor… |
| INTERNAL | `lib/command-center/support-ops.ts` | 87 | openConversationLoad: metric(openConv, 'derived_actual', { coverage: 1, freshnessAt: … |
| INTERNAL | `lib/command-center/types.ts` | 62 | platformFeeCentsPerClient: Cents // Scalix revenue per WL end-client (the $97 platfor… |
| INTERNAL | `lib/dashboard/drilldown.ts` | 21 | ownerTimeSaved: boolean        // Scalix responded AND no human takeover → green block |
| INTERNAL | `lib/documents/no-platform-branding.test.ts` | 7 | // This bug shipped INSIDE the commit that built the white-label system ("Remove Scal… |
| INTERNAL | `lib/documents/no-platform-branding.test.ts` | 65 | // Both of these render visible "Powered by Scalix" text elsewhere in the app. |
| INTERNAL | `lib/documents/no-platform-branding.test.ts` | 66 | expect(NEUTRAL_BRAND.poweredByScalix).toBe(false) |
| INTERNAL | `lib/documents/routes.ts` | 45 | // Scalix" line in the sidebar and on the invite page — and a document must be able t… |
| INTERNAL | `lib/documents/routes.ts` | 47 | poweredByScalix: false, |
| INTERNAL | `lib/ingestion/http.ts` | 5 | //     ScalixBot/1.0 (+https://scalix26.com/bot) |
| INTERNAL | `lib/ingestion/http.ts` | 17 | export const BOT_USER_AGENT = 'ScalixBot/1.0 (+https://scalix26.com/bot)' |
| INTERNAL | `lib/ingestion/robots.ts` | 23 | // Parses the groups that apply to us: the wildcard group plus any group naming Scali… |
| INTERNAL | `lib/leads/speed-to-lead.ts` | 47 | // No-op for direct Scalix tenants and while WL_BILLING_ENABLED is off. |
| INTERNAL | `lib/meta/scopes.ts` | 28 | //   Name        Scalix26 Production |
| INTERNAL | `lib/partner/brand.ts` | 5 | // domain) overrides the static host brand — otherwise we fall back to the existing S… |
| INTERNAL | `lib/partner/brand.ts` | 19 | poweredByScalix: boolean |
| INTERNAL | `lib/partner/brand.ts` | 42 | poweredByScalix: true, isPartnerBrand: false, |
| INTERNAL | `lib/partner/brand.ts` | 61 | poweredByScalix: data.powered_by_scalix ?? true, isPartnerBrand: true, |
| INTERNAL | `lib/partner/brand.ts` | 81 | name: data.company_name \|\| 'Scalix', |
| INTERNAL | `lib/partner/brand.ts` | 86 | poweredByScalix: data.powered_by_scalix ?? true, isPartnerBrand: true, |
| INTERNAL | `lib/partner/coach.ts` | 10 | // `icon` is a Scalix icon key (see CoachIcon), never an emoji. |
| INTERNAL | `lib/partner/crm.ts` | 1 | // Shared CRM constants (isomorphic — safe in client components). Scalix V3 sales fun… |
| INTERNAL | `lib/partner/demo.ts` | 86 | 'This is a live demo of Scalix26 AI. Never say you are a language model; you are thei… |
| INTERNAL | `lib/partner/economics.ts` | 63 | // Reseller partners are billed wholesale by Scalix — events route to reseller invoic… |
| INTERNAL | `lib/partner/integrations.ts` | 5 | // Twilio / OpenAI / ElevenLabs / Email accounts — Scalix stores them encrypted and p… |
| INTERNAL | `lib/partner/invite-email.ts` | 7 | // visible FROM NAME is the partner's brand, so the recipient never sees "Scalix". |
| INTERNAL | `lib/partner/invite-email.ts` | 10 | // details. Never references Scalix, the partner portal, commissions, or wholesale. "… |
| INTERNAL | `lib/partner/invite-email.ts` | 22 | const poweredBy = brand.poweredByScalix ? ` · Powered by Scalix` : '' |
| INTERNAL | `lib/partner/invites.ts` | 4 | // Client-invitation data layer. Server-only (admin client). One Scalix product — thi… |
| INTERNAL | `lib/partner/marketing-ai.ts` | 10 | const BRAND = `Scalix26 is an AI employee for local/service businesses: it learns the… |
| INTERNAL | `lib/partner/marketing-ai.ts` | 92 | const system = `${BRAND}\n\nYou are a senior direct-response marketer helping a Scali… |
| INTERNAL | `lib/partner/marketing-ai.ts` | 101 | const system = `${BRAND}\n\nYou are a landing-page conversion expert helping a Scalix… |
| INTERNAL | `lib/partner/xp.ts` | 54 | // `icon` is a Scalix icon key (rendered via lucide), never an emoji. |
| INTERNAL | `lib/playbook/compile.ts` | 7 | export const PLAYBOOK_START = '═══ SCALIX PLAYBOOK — managed by Scalix, do not edit b… |
| INTERNAL | `lib/scrape-headers.ts` | 2 | // real desktop browser: a custom bot User-Agent (e.g. "ScalixBot/1.0") trips some |
| INTERNAL | `lib/supabase/middleware.ts` | 34 | // External order-approval: the factory/customer has no Scalix account — the secure t… |
| INTERNAL | `lib/supabase/middleware.ts` | 41 | // capability — the owner shares the link with a client/supplier who has no Scalix ac… |
| INTERNAL | `lib/workspace.ts` | 25 | // whole app renders in the partner's brand and hides partner/Scalix surfaces). Null … |
