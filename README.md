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

The corner logo starts voice and becomes an animated listening/speaking indicator; click it again to end voice. The adjacent chat button opens the shared text conversation. Voice details, errors, and text fallback live behind a separate controls button. Audio settings offer microphone and speaker selection with local tests in a wider, responsive dialog.

Chat uses logo-only branding, a history dropdown, streamed Markdown, tool progress, copy, and cancellation. Conversation options contain usage totals and a per-turn breakdown of provider-reported Gateway costs and tokens; ElevenLabs session charges remain separate. New conversations default to Claude Sonnet 5.5; existing explicit model choices are preserved. `AI_MODEL` can override both the assistant and extraction defaults; extraction otherwise stays on Sonnet 4.5.
