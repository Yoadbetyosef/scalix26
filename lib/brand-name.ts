// The fallback brand name, in a module a CLIENT component can import.
//
// ── WHY IT IS NOT IN lib/partner/brand.ts ───────────────────────────────────────────────────────────
//
// That was the first attempt and it broke the build. brand.ts imports lib/supabase/server.ts, which
// imports next/headers — server-only. Four dashboard client components import this constant, so
// putting it there dragged the server Supabase client into the browser bundle and the compile failed
// with "You're importing a module that depends on next/headers".
//
// A constant with no dependencies belongs in a module with no dependencies. This file imports nothing
// and can therefore be read from either side of the server/client boundary, which is the whole
// requirement.
//
// It deliberately does not change what the name SAYS — only how many places say it. Six sites used to
// carry the literal, so a white-label tenant whose brand failed to resolve saw our name in six
// different places and changing it meant finding all six.

export const FALLBACK_BRAND_NAME = 'Scalix'
