# Catalog ingestion worker.
#
# IMPORTANT: build this with the REPOSITORY ROOT as the context, not this folder. The worker imports
# pure modules out of the app's lib/ (lib/ingestion, lib/cost/rates, lib/billing/pricing) so that
# extraction rules and pricing maths have exactly one definition. Building from catalog-worker/ alone
# would leave those imports unresolved.
#
#   docker build -f catalog-worker/Dockerfile -t catalog-worker .
#
# On Railway: Root Directory = / (repo root), Dockerfile Path = catalog-worker/Dockerfile.
FROM node:22-alpine

WORKDIR /app

# Dependencies install at /app, NOT at /app/catalog-worker — and that placement is the whole point.
# Node resolves a bare import by walking UP from the importing FILE: lib/ingestion/sources/index.ts
# imports zod, so it looks in /app/lib/ingestion/sources/node_modules, then /app/lib/ingestion/…,
# /app/lib/…, /app/node_modules. It never looks inside /app/catalog-worker/node_modules, because that
# is a sibling, not a parent. Installing one directory lower is what put zod somewhere the shared lib
# could not see it. Locally this never showed, because there node_modules sits at the repo root and
# lib/ is underneath it — exactly the arrangement reproduced here.
COPY catalog-worker/package.json catalog-worker/package-lock.json ./
RUN npm ci --omit=dev

# The worker, plus only the parts of the app it actually imports.
COPY catalog-worker/*.ts ./catalog-worker/
COPY lib/ingestion/ ./lib/ingestion/
COPY lib/cost/rates.ts ./lib/cost/rates.ts
COPY lib/billing/pricing.ts ./lib/billing/pricing.ts
COPY lib/csv/parse.ts ./lib/csv/parse.ts
COPY lib/scrape-headers.ts ./lib/scrape-headers.ts

# Test files travel with lib/ingestion and import vitest, which is not a runtime dependency. Nothing
# loads them, but an image that carries a module it cannot resolve is a trap for the next person.
RUN find ./lib -name '*.test.ts' -delete

# Fail at BUILD time rather than on the platform: prove every bare import the worker will make can
# actually be resolved from where its file sits. This is the check that was missing.
RUN node -e "for (const m of ['zod','ws','@supabase/supabase-js','@anthropic-ai/sdk','tsx']) { require.resolve(m); } console.log('runtime deps resolve from /app')" \
 && node --experimental-strip-types -e "import('./lib/ingestion/normalizer.ts').then(()=>console.log('shared lib resolves its imports')).catch(e=>{console.error(e.message);process.exit(1)})"

# Run from /app so the resolution root is the directory holding node_modules.
# No port: this service takes no traffic. It polls the job queue and exits cleanly on SIGTERM.
CMD ["npx", "tsx", "catalog-worker/index.ts"]
