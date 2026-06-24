import type { NextConfig } from "next";

// Supabase origin (for CSP connect-src). Read at build time.
const SUPABASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_WSS = SUPABASE.replace(/^https:/, "wss:");

// Content-Security-Policy — shipped as REPORT-ONLY first so it can NEVER break
// rendering, Vercel, Supabase, or third-party flows; violations can be reviewed
// before enforcing. Sources reflect the real app (Supabase, Stripe redirect,
// data/blob images, inline styles + Next hydration scripts).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  // Next.js App Router injects inline hydration scripts; no nonce infra yet.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} ${SUPABASE_WSS} https://*.supabase.co wss://*.supabase.co https://api.stripe.com`.replace(/\s+/g, " ").trim(),
  "frame-src 'self' https://js.stripe.com https://checkout.stripe.com",
  "media-src 'self' blob: data:",
].join("; ");

const securityHeaders = [
  // Force HTTPS for 2 years incl. subdomains (the app is HTTPS-only on Vercel).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self) is required by the in-browser voice demo (getUserMedia).
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(self), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Content-Security-Policy-Report-Only", value: csp },
];

const nextConfig: NextConfig = {
  // pdf-parse bundles pdfjs; keep it external so Next doesn't bundle it (avoids
  // worker/bundling issues in the serverless function that runs the website crawler).
  serverExternalPackages: ["pdf-parse"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
