// Structured "is this a real customer email?" gate. NO LLM, pure + unit-testable.
// CONSERVATIVE: returns blocked=true ONLY for senders we're confident are not
// customers (automated/notification/platform/self/own-domain). Anything uncertain →
// blocked=false (treated as a real customer). Never risk silencing a real customer.

// 1) Automated local-part tokens (the part before @).
const AUTOMATED_LOCAL_TOKENS = [
  'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
  'mailer-daemon', 'mailerdaemon', 'postmaster', 'bounce', 'bounces',
  'notification', 'notifications', 'notify', 'alert', 'alerts', 'automated', 'mailer', 'system',
]
// 2) Notification subdomain tokens in the domain (NOT bare "mail." — too broad).
const DOMAIN_NOTIFICATION_TOKENS = ['mailer.', 'notifications.', 'notification.', 'transaction.', 'bounces.']
// 3) Known platform/notification domains (block these and all subdomains).
const PLATFORM_DOMAINS = [
  'acuityscheduling-mail.com', 'acuityscheduling.com', 'calendly.com', 'squareup.com', 'square.com',
  'sendgrid.net', 'mailchimp.com', 'mandrillapp.com', 'intuit.com', 'quickbooks.com', 'stripe.com',
  'paypal.com', 'zendesk.com', 'tiktok.com', 'zeffy.com', 'facebookmail.com',
]
// 4) Our own platform/self domains.
const SELF_DOMAINS = ['scalix26.com', 'mylocksmithai.com']

function domainMatches(domain: string, base: string): boolean {
  return domain === base || domain.endsWith('.' + base)
}

export function isNonCustomerEmail(senderEmail: string | null | undefined, tenantDomains: string[] = []): { blocked: boolean; reason: string } {
  try {
    if (!senderEmail) return { blocked: false, reason: '' }
    const e = senderEmail.trim().toLowerCase()
    const at = e.lastIndexOf('@')
    if (at < 1 || at === e.length - 1) return { blocked: false, reason: '' }
    const local = e.slice(0, at)
    const domain = e.slice(at + 1)

    // 1) Automated local-part: exact match, a clear token within the local-part, or a
    //    hyphen/underscore form appearing in the local-part.
    const localTokens = local.split(/[^a-z0-9]+/).filter(Boolean)
    for (const t of AUTOMATED_LOCAL_TOKENS) {
      if (local === t) return { blocked: true, reason: `automated-local:${t}` }
      if (localTokens.includes(t)) return { blocked: true, reason: `automated-local:${t}` }
      if (/[^a-z0-9]/.test(t) && local.includes(t)) return { blocked: true, reason: `automated-local:${t}` }
    }

    // 2) Notification subdomain token in the domain.
    for (const tok of DOMAIN_NOTIFICATION_TOKENS) {
      if (domain.includes(tok)) return { blocked: true, reason: `domain-notif:${tok}` }
    }

    // 3) Known platform domains (+ subdomains).
    for (const pd of PLATFORM_DOMAINS) {
      if (domainMatches(domain, pd)) return { blocked: true, reason: `platform:${pd}` }
    }

    // 4) Tenant's own domain(s) + our self domains (+ subdomains).
    for (const od of [...tenantDomains.map((d) => (d || '').toLowerCase()).filter(Boolean), ...SELF_DOMAINS]) {
      if (domainMatches(domain, od)) return { blocked: true, reason: `own-domain:${od}` }
    }

    return { blocked: false, reason: '' }
  } catch {
    // Fail-safe: on any error, treat as a real customer (never silently drop one).
    return { blocked: false, reason: '' }
  }
}

// Extract distinct domains from a list of email addresses (e.g. a tenant's connected
// mailbox addresses) → used as that tenant's "own domains".
export function domainsFromEmails(emails: (string | null | undefined)[]): string[] {
  const s = new Set<string>()
  for (const e of emails) {
    const d = (e || '').toLowerCase().split('@')[1]
    if (d) s.add(d.trim())
  }
  return [...s]
}
