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

# Dependencies first so a code change doesn't reinstall them.
COPY catalog-worker/package*.json ./catalog-worker/
RUN cd catalog-worker && npm install --omit=dev

# The worker, plus only the parts of the app it actually imports.
COPY catalog-worker/ ./catalog-worker/
COPY lib/ingestion/ ./lib/ingestion/
COPY lib/cost/rates.ts ./lib/cost/rates.ts
COPY lib/billing/pricing.ts ./lib/billing/pricing.ts
COPY lib/csv/parse.ts ./lib/csv/parse.ts
COPY lib/scrape-headers.ts ./lib/scrape-headers.ts

WORKDIR /app/catalog-worker

# No port: this service takes no traffic. It polls the job queue and exits cleanly on SIGTERM.
CMD ["npm", "start"]
