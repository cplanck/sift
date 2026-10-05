# Sift implementation

## Current milestone

M3 — Ingestion/media/sharing implemented and local checks passed; live Gateway verification in progress. M0 committed (`70aa08e`), M1 committed (`f2f0857`), M2 committed (`540a40e`). Next milestone: M4.

## Completed work

- Read the entire supplied `SIFT_SPEC.md` before modifying the repository. It is the product and architecture source of truth; no `SPEC.md` exists in the starting repository.
- Next.js App Router, strict TypeScript, pnpm, Tailwind, official shadcn/ui primitives, Lucide, locally bundled Inter, system-aware dark theme, responsive brand shell.
- Custom monochrome Sift mark; generated favicon, touch, PWA and maskable icons.
- Manifest, controlled service-worker updates, public static caching, offline fallback and connection indicator. No authenticated API caching.
- Central environment validation that never puts secret values in error messages.
- Lint, typecheck, Vitest, production build and Playwright commands.
- M1: Better Auth email/password registration, sign-in and sign-out; protected Library; PostgreSQL schema and migrations; personal workspace creation serialized in a transaction; membership authorization primitives; real PostgreSQL integration tests.
- M2: structured ingredient/instruction sections, lossless quantity text and deterministic scaling, canonical recipe snapshots, immutable version creation and restoration, optimistic favorites with rollback, first-class notes, archive/restore, direct title correction, and instant ranked Library search.
- Reviewed the user-supplied `reference-ui.png`. Applied its charcoal surfaces, search prominence, recent strip, compact recipe list, tabs and restrained controls. Photo-led presentation will use uploaded media in M3; no fabricated recipe content or photo integrations.
- Installed official shadcn/ui Button, Input, Textarea, Dialog, Sheet, Tabs and DropdownMenu from the registry. Customized neutral theme tokens and touch-target sizes locally. Fixed the registry's generated `cn` import to use the configured local utility.
- M3: structured paste/JSON and schema.org URL extraction, real Gateway text/image extraction, durable Inngest imports, editable draft review and approval, preserved provenance, private R2 uploads with progress/compression/server image normalization, multiple recipe photos/cover selection, and explicit unlisted immutable sharing/revocation.
- Fixed development service-worker caching reported during live use: register only in production, clear legacy development registrations/caches before hydration, and cache Next.js chunks only when the response declares them immutable. Development recovery leaves cookies and recipe data intact.

## Architectural decisions

- Retain the supplied specification filename unchanged.
- Use the current stable Next.js App Router. Load provider clients lazily so a build does not require live credentials; operations requiring missing configuration fail explicitly.
- Bundle Inter locally, avoiding a build-time external font dependency.
- Service worker caches only public assets and an offline document at M0. Account-scoped recent recipe storage belongs to M5.
- TypeScript 6 and ESLint 9 are pinned to the versions supported by the current Next.js lint plugins (ESLint 10 fails in the upstream React plugin). Revisit on a compatible plugin release.
- Drizzle uses `pg` over PostgreSQL TCP for both Neon and local development, as supported by [Drizzle's Neon documentation](https://orm.drizzle.team/docs/connect-neon). Interactive transactions are required for bootstrap and later versioning. Production uses the Neon pooled connection string with TLS; local tests use isolated PostgreSQL 17, not an in-memory substitute.
- UUIDs throughout, timezone-aware UTC timestamps, membership indexes and foreign keys. User creation invokes transactional personal-workspace bootstrap; authenticated entry repairs an interrupted initial bootstrap idempotently. Removed memberships are never silently recreated.
- Better Auth owns session/password handling and database-backed auth rate limits. API and server-page boundaries derive identity from the session; each domain operation independently checks membership. Active-workspace metadata is not client-writable.
- Canonical recipe content is a validated JSONB snapshot on each version; source provenance and lifecycle live on the parent recipe. Updates lock the parent and compare the expected version to prevent lost edits. Restore appends a new version. Notes/favorites never create canonical versions.
- Library receives a compact workspace-scoped index for immediate client-side search. UI and server use the same exact/prefix/substring/tag/ingredient/note ranking. Full-text/trigram infrastructure is not needed for a personal cookbook at this stage; there is no arbitrary truncation of the searchable Library.
- Composite workspace/recipe foreign keys supplement service authorization. Reviewed M2's generated SQL and moved its supporting unique index before the dependent foreign keys (Drizzle emitted the reverse order).
- Imports converge on the same canonical schema and recipe/version services. Deterministic parsing runs without an LLM where possible; other text/image extraction uses AI SDK structured output through the centralized Anthropic/Gateway registry. The registry is introduced in M3 because extraction needs it; M4 supplies the conversational runtime.
- URL fetches validate every redirect and DNS answer, pin the validated address to the socket, reject private/local addresses and unsupported ports/content types, and bound bytes/time. Imported content is untrusted data with no extraction tools or model instruction authority.
- Inngest events and step results carry identifiers, not raw recipe text/photos. Jobs resolve the creator/workspace from the database, recheck membership, and idempotently create review drafts. Conflicting approval submissions fail rather than discard corrections. Generic recipe status changes cannot bypass draft review.
- R2 receives short-lived signed uploads under `uploads/workspaces/…`. Completion checks membership, validates actual image decoding/size, strips metadata, and publishes a unique immutable WebP under `workspaces/…` with a transaction-protected winner. Uploads and completion have separate atomic usage limits.
- Share tokens contain 256 bits of randomness and are stored only as SHA-256 hashes. Creation checks the displayed recipe version and cover; links expose that immutable snapshot and its selected image. Public HTML and images recheck the token, use no-store/noindex/no-referrer, and exclude private notes/history/raw sources. Revocation takes effect on subsequent requests.

## Deviations

No product or architecture deviations. The model registry precedes the assistant milestone only to support real M3 extraction. Provider-dependent code is implemented, but live verification remains explicitly outstanding until credentials are supplied.

## Unresolved issues

- AI Gateway credentials have been configured locally; live verification is in progress. R2 credentials are still needed for live uploads. Unit tests replace only provider transport at the test boundary; the application contains no fake integration path.
- M4–M9 remain unimplemented. The V1 definition of done is not yet met.

## Required manual/provider configuration

1. Install Node.js 22+ and pnpm 10.28.0; run `pnpm install`.
2. Copy `.env.example` to `.env.local`. Use separate credentials for development and production.
3. Create a Neon project/database. In Connect, select a pooled PostgreSQL connection and copy its URL (including `sslmode=require`) to `DATABASE_URL`. Use a separate Neon branch for development if desired.
4. Set `BETTER_AUTH_SECRET` to an unpredictable value (`openssl rand -base64 32`). Set `BETTER_AUTH_URL` to the exact application origin: local `http://localhost:3003`, production `https://your-domain`. Put production values in Vercel server environment variables; no `NEXT_PUBLIC_` secrets.
5. Run `pnpm db:migrate` against the chosen database, then `pnpm dev`. Production: `pnpm build` then `pnpm start`. On Vercel, select Next.js and pnpm, set the environment, apply migrations, then deploy. Schema changes: `pnpm db:generate`, review and commit the generated SQL, then migrate.
6. Local alternative: `pnpm db:up` creates PostgreSQL on localhost:55432. Use `postgresql://sift:sift-local-only@localhost:55432/sift` in `.env.local`. A local database and secret have been configured in this workspace (ignored by Git). This workspace's existing container was initially created directly; use `docker start sift-postgres` to restart it instead of creating a conflicting Compose container. The dev server runs at **http://localhost:3003**.
7. Tests use a separate `sift_test` database, created/migrated automatically. Override `TEST_DATABASE_URL` only with a dedicated database whose name ends in `_test`. Playwright runs a production server on port 3100 with that test database; it does not use your development cookbook.
8. M1 uses email/password without email verification or password-reset delivery. No email provider is required by this milestone and no unimplemented reset link is shown.
9. **R2:** create a private bucket with public `r2.dev`/custom-domain access disabled. Create a bucket-scoped Object Read & Write API token. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in server environment variables. Add bucket CORS with exact local/production origins, PUT, and Content-Type, for example:

   ```json
   [{ "AllowedOrigins": ["http://localhost:3003", "https://your-domain"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
   ```

   Add an object lifecycle rule deleting objects with prefix `uploads/` after one day to clean up abandoned signed uploads. Do not expire the canonical `workspaces/` prefix. Completed source uploads are also deleted best-effort. Images are served through authorized application endpoints, not public bucket URLs.
10. **Inngest:** for local jobs set `INNGEST_DEV=1` and run `pnpm dlx inngest-cli@latest dev --host 127.0.0.1 --no-discovery -u http://localhost:3003/api/inngest`. The local dashboard is http://localhost:8288; it is running in this workspace. For production create an Inngest environment, set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`, then sync `https://your-domain/api/inngest` (or connect the Vercel integration). Production always requires signing; `INNGEST_DEV` does not disable this. The handler allows 120 seconds and checkpoints before that deadline. Structured paste imports work without a job service.
11. **AI Gateway:** create a Vercel AI Gateway API key, fund/enable its account, and set `AI_GATEWAY_API_KEY` on the server. The centralized initial model is `anthropic/claude-sonnet-4.5`; optional `AI_MODEL` accepts an Anthropic Gateway model ID. No direct Anthropic key is needed. Freeform pasted text, URLs without usable Recipe JSON-LD, and recipe-image extraction use this integration. Missing configuration is reported explicitly in the import state. Per-user encrypted credentials arrive with M4.
12. Playwright explicitly clears provider credentials in its isolated production server to verify missing-provider behavior without spending live provider credits. For live verification, upload a recipe photo, choose another cover, import a photo/URL, approve its corrections, create an unlisted link in a private browser, and revoke it. Gateway and R2 roundtrips remain unverified until configured.

## Verification

M0 passed: `pnpm lint`, `pnpm typecheck`, `pnpm test` (2 tests), `pnpm build`, `pnpm test:e2e` (6 tests across desktop, phone, landscape tablet). Browser tests verify layout, theme, manifest/icons, service-worker installation and offline navigation.

M1 passed: lint, typecheck, 5 Vitest tests (including real PostgreSQL concurrency/isolation/revocation checks), production build, and all 9 Playwright checks. Signup/sign-in/sign-out and stable personal-workspace identity verified on desktop, phone and tablet. The dev sign-in page returns HTTP 200 on port 3003. Live Neon deployment is not yet exercised; the same PostgreSQL driver/migrations run locally.

M2 passed: lint, typecheck, 21 Vitest tests, production build, and all 12 Playwright checks. Browser flows cover real recipe creation, prefix search, serving scaling, notes, version creation/restoration, favorite rollback on network failure, cross-user ID attacks, cross-origin mutation rejection, and desktop/phone/tablet layouts. Reviewed dark desktop Library and phone recipe screenshots; corrected the single-card recent-strip width.

M3 passed: lint, typecheck, 52 Vitest tests, production build, and all 18 Playwright checks. Added real-database import approval/retry/version/isolation, share snapshots/revocation/privacy, atomic rate limits, SSRF/deadline tests, real Sharp decoding, and concurrent image-finalization checks. Browser tests exercise paste review/correction/approval, anonymous sharing/revocation, missing-provider states, malformed/oversized requests, and desktop/phone/tablet layouts. Test contexts use separate documentation-range IPs so parallel signups exercise actual auth limits without tripping one shared address's budget. Reviewed import-review and public-share screenshots.

Development-cache regression verified with isolated Chromium on port 3003: seeded a worker and deliberately corrupted cached Turbopack bootstrap, observed automatic Sift-only cache/worker removal and reload, then checked hydration/navigation/refresh with zero runtime errors. HttpOnly cookies, localStorage and unrelated caches survived. The recovery script is a native development-only head script because Next's queued `beforeInteractive` scripts themselves require a working bootstrap.

In the Codex sandbox, Next.js/Turbopack and browser tests need local process/network permissions. A failed sandbox build can cache its port-binding failure; clearing `.next` and rerunning with the necessary permissions resolved it. No bundler or architecture change was needed.

## Next steps

Finish integrated M3 verification and commit the checkpoint, then implement M4's persistent page-aware assistant with the AI SDK tool-loop agent, scoped recipe tools, streaming, and encrypted user Gateway credentials. Continue the remaining milestones sequentially.
