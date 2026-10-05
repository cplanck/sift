# Sift implementation

## Current milestone

M1 — Persistence/auth complete. M0 committed (`70aa08e`). Next milestone: M2.

## Completed work

- Read the entire supplied `SIFT_SPEC.md` before modifying the repository. It is the product and architecture source of truth; no `SPEC.md` exists in the starting repository.
- Next.js App Router, strict TypeScript, pnpm, Tailwind, shadcn-style accessible primitives, Lucide, locally bundled Inter, system-aware dark theme, responsive brand shell.
- Custom monochrome Sift mark; generated favicon, touch, PWA and maskable icons.
- Manifest, controlled service-worker updates, public static caching, offline fallback and connection indicator. No authenticated API caching.
- Central environment validation that never puts secret values in error messages.
- Lint, typecheck, Vitest, production build and Playwright commands.
- M1: Better Auth email/password registration, sign-in and sign-out; protected Library; PostgreSQL schema and migrations; personal workspace creation serialized in a transaction; membership authorization primitives; real PostgreSQL integration tests.

## Architectural decisions

- Retain the supplied specification filename unchanged.
- Use the current stable Next.js App Router. Load provider clients lazily so a build does not require live credentials; operations requiring missing configuration fail explicitly.
- Bundle Inter locally, avoiding a build-time external font dependency.
- Service worker caches only public assets and an offline document at M0. Account-scoped recent recipe storage belongs to M5.
- TypeScript 6 and ESLint 9 are pinned to the versions supported by the current Next.js lint plugins (ESLint 10 fails in the upstream React plugin). Revisit on a compatible plugin release.
- Drizzle uses `pg` over PostgreSQL TCP for both Neon and local development, as supported by [Drizzle's Neon documentation](https://orm.drizzle.team/docs/connect-neon). Interactive transactions are required for bootstrap and later versioning. Production uses the Neon pooled connection string with TLS; local tests use isolated PostgreSQL 17, not an in-memory substitute.
- UUIDs throughout, timezone-aware UTC timestamps, membership indexes and foreign keys. User creation invokes transactional personal-workspace bootstrap; authenticated entry repairs an interrupted initial bootstrap idempotently. Removed memberships are never silently recreated.
- Better Auth owns session/password handling and database-backed auth rate limits. API and server-page boundaries derive identity from the session; each domain operation independently checks membership. Active-workspace metadata is not client-writable.

## Deviations

None. Milestones beyond M0 are not yet claimed complete.

## Unresolved issues

- No provider credentials were supplied; live provider verification will be tracked separately from local tests.

## Required manual/provider configuration

1. Install Node.js 22+ and pnpm 10.28.0; run `pnpm install`.
2. Copy `.env.example` to `.env.local`. Use separate credentials for development and production.
3. Create a Neon project/database. In Connect, select a pooled PostgreSQL connection and copy its URL (including `sslmode=require`) to `DATABASE_URL`. Use a separate Neon branch for development if desired.
4. Set `BETTER_AUTH_SECRET` to an unpredictable value (`openssl rand -base64 32`). Set `BETTER_AUTH_URL` to the exact application origin: local `http://localhost:3003`, production `https://your-domain`. Put production values in Vercel server environment variables; no `NEXT_PUBLIC_` secrets.
5. Run `pnpm db:migrate` against the chosen database, then `pnpm dev`. Production: `pnpm build` then `pnpm start`. On Vercel, select Next.js and pnpm, set the environment, apply migrations, then deploy. Schema changes: `pnpm db:generate`, review and commit the generated SQL, then migrate.
6. Local alternative: `pnpm db:up` creates PostgreSQL on localhost:55432. Use `postgresql://sift:sift-local-only@localhost:55432/sift` in `.env.local`. A local database and secret have been configured in this workspace (ignored by Git). The dev server runs at **http://localhost:3003**.
7. Tests use a separate `sift_test` database, created/migrated automatically. Override `TEST_DATABASE_URL` only with a dedicated database whose name ends in `_test`. Playwright runs a production server on port 3100 with that test database; it does not use your development cookbook.
8. M1 uses email/password without email verification or password-reset delivery. No email provider is required by this milestone and no unimplemented reset link is shown.

## Verification

M0 passed: `pnpm lint`, `pnpm typecheck`, `pnpm test` (2 tests), `pnpm build`, `pnpm test:e2e` (6 tests across desktop, phone, landscape tablet). Browser tests verify layout, theme, manifest/icons, service-worker installation and offline navigation.

M1 passed: lint, typecheck, 5 Vitest tests (including real PostgreSQL concurrency/isolation/revocation checks), production build, and all 9 Playwright checks. Signup/sign-in/sign-out and stable personal-workspace identity verified on desktop, phone and tablet. The dev sign-in page returns HTTP 200 on port 3003. Live Neon deployment is not yet exercised; the same PostgreSQL driver/migrations run locally.

In the Codex sandbox, Next.js/Turbopack and browser tests need local process/network permissions. A failed sandbox build can cache its port-binding failure; clearing `.next` and rerunning with the necessary permissions resolved it. No bundler or architecture change was needed.

## Next steps

Continue to M2 recipe domain, immutable versions, notes, deterministic search and Library/recipe views.
