# Sift implementation

## Current milestone

M0 — Foundation complete. Next milestone: M1 persistence/auth.

## Completed work

- Read the entire supplied `SIFT_SPEC.md` before modifying the repository. It is the product and architecture source of truth; no `SPEC.md` exists in the starting repository.
- Next.js App Router, strict TypeScript, pnpm, Tailwind, shadcn-style accessible primitives, Lucide, locally bundled Inter, system-aware dark theme, responsive brand shell.
- Custom monochrome Sift mark; generated favicon, touch, PWA and maskable icons.
- Manifest, controlled service-worker updates, public static caching, offline fallback and connection indicator. No authenticated API caching.
- Central environment validation that never puts secret values in error messages.
- Lint, typecheck, Vitest, production build and Playwright commands.

## Architectural decisions

- Retain the supplied specification filename unchanged.
- Use the current stable Next.js App Router. Load provider clients lazily so a build does not require live credentials; operations requiring missing configuration fail explicitly.
- Bundle Inter locally, avoiding a build-time external font dependency.
- Service worker caches only public assets and an offline document at M0. Account-scoped recent recipe storage belongs to M5.
- TypeScript 6 and ESLint 9 are pinned to the versions supported by the current Next.js lint plugins (ESLint 10 fails in the upstream React plugin). Revisit on a compatible plugin release.

## Deviations

None. Milestones beyond M0 are not yet claimed complete.

## Unresolved issues

- No provider credentials were supplied; live provider verification will be tracked separately from local tests.

## Required manual/provider configuration

1. Install Node.js 22+ and pnpm 10.28.0; run `pnpm install`.
2. Copy `.env.example` to `.env.local`. Use separate credentials for development and production.
3. M1 will require a Neon PostgreSQL database URL, an unpredictable Better Auth secret (`openssl rand -base64 32`), and `BETTER_AUTH_URL` matching the application origin. Exact migration and provider steps will be added with each integration.
4. Run `pnpm dev`. Production: `pnpm build` then `pnpm start`.

## Verification

M0 passed: `pnpm lint`, `pnpm typecheck`, `pnpm test` (2 tests), `pnpm build`, `pnpm test:e2e` (6 tests across desktop, phone, landscape tablet). Browser tests verify layout, theme, manifest/icons, service-worker installation and offline navigation.

In the Codex sandbox, Next.js/Turbopack and browser tests need local process/network permissions. A failed sandbox build can cache its port-binding failure; clearing `.next` and rerunning with the necessary permissions resolved it. No bundler or architecture change was needed.

## Next steps

Implement M1 persistence, authentication, personal workspace bootstrap and mandatory isolation tests.
