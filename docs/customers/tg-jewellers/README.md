# TG Jewellers — customer reference material

Tatiana, Vancouver BC. Two companies under one tenant:

- **TG Jewellers** — retail
- **TG Designs** — B2B

## What belongs here

Reference material only: her brand guide, and the sample estimate from her previous CRM showing the
layout she wants. These are read by whoever works on her issues; nothing here is served.

## What does NOT belong here

**Her logo files.** They go through the branding modal on a document page (`/api/orders/logo-upload`)
into storage, exactly like every other tenant's. Committing one tenant's assets to the repo would make
her a special case in a product whose whole point is that she is not one — and the document renderer
reads the uploaded URL, not the filesystem, so a committed file would not even be used.
