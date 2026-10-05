# sift

Your personal cookbook that you can talk to.

Product and architecture: [SIFT_SPEC.md](SIFT_SPEC.md). Current progress, setup and verification: [IMPLEMENTATION.md](IMPLEMENTATION.md).

```sh
pnpm install
cp .env.example .env.local
pnpm dev
```

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Playwright uses the production build on port 3100. Install its browser once with `pnpm exec playwright install chromium`.
