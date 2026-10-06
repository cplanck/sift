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

Recipes without an uploaded cover use bundled [Pexels](https://www.pexels.com) food photography. Set the optional server-only `UNSPLASH_ACCESS_KEY` to search for a closer match automatically as recipes enter view. Create a free developer application at [Unsplash](https://unsplash.com/oauth/applications); its starter limit is 50 API requests/hour. An existing `PEXELS_API_KEY` is also supported when Unsplash is not configured; Pexels has currently paused new key issuance. No key is needed for the bundled collection. Provider search results are cached for seven days, but the first successful provider photo is saved per recipe in the database. Visits, recipe edits, version restores, and builds reuse that selection without searching again. Selection happens when a recipe first enters view, not during build or import. Outages, quota limits, or empty results retain a temporary bundled image and can retry on a later visit. Uploaded covers take priority. Stock-photo credit overlays are temporarily hidden for prototyping. Attribution metadata and the optional credit UI remain available to restore later; Unsplash images retain their original hotlinks. These representative search images never become selected uploaded covers or appear in private photo galleries or shared recipe snapshots.

The library uses a compact four-column desktop and two-column phone grid, with search, recent recipes, favorites, vegetarian and under-30-minute filters. Recipe details put the photo beside a short overview and timing; full descriptions and substitutions remain available in Notes. Add Recipe opens with URL import, with Photo, Text and Manual entry alongside it. The landing page uses food photography and the bowl-and-dots Sift identity.

Sift opens the shared assistant panel. The composer has separate dictation and live voice buttons. Conversation selection and photo attachments sit below the input; Conversation settings contains model selection, microphone and speaker devices, rename, delete, and usage. Audio settings include local microphone and speaker tests.

Chat uses streamed Markdown, compact action summaries, copy, and cancellation. Conversation options contain usage totals and a per-turn breakdown of provider-reported Gateway costs and tokens; ElevenLabs session charges remain separate. New conversations default to Claude Sonnet 5.5; existing explicit model choices are preserved. `AI_MODEL` can override both the assistant and extraction defaults; extraction otherwise stays on Sonnet 4.5.

Development favicons and installable app icons are blue; production icons are black. Selection follows `VERCEL_ENV`, or the local `BETTER_AUTH_URL`/development runtime outside Vercel. SVG, PNG, Apple touch, and maskable PWA icons are generated together with `pnpm icons`.

To preview a production-to-local content sync, run `pnpm sync:prod`; run `pnpm sync:prod --apply` to apply it. It copies recipes and versions, notes/favorites, imports, cooking history/photos, grocery/meal-plan artifacts, conversations, and usage history into the matching local account. Stable IDs prevent duplicate copies; later production updates apply when the local copy has not changed. Local edits are reported as conflicts, and local-only content is retained. Source deletions do not delete local records. Login credentials, connected-app grants, and live session access stay environment-specific.

Once the account has been seeded, the local Library account menu also has **Sync from prod**. It previews changes, lets you apply them, and refreshes the cookbook. The control and endpoint are disabled on deployed environments and nonlocal databases; only a signed-in personal workspace approved by a prior CLI sync can use the cached production connection.

Production is read through an enforced read-only snapshot, and writes require a localhost database. `--refresh-connection` retrieves only the production `DATABASE_URL` from the linked Vercel project into ignored, mode-0600 `.local/production-database.json`. Use `--email you@example.com` to select an account when there are several matches, and `--local-email` if its local email differs. Each apply saves a private backup and sync state under `.local/production-sync/`. Existing local R2 credentials are used to copy uploaded images into the local workspace's own storage prefix. In-flight imports and voice/chat runs are copied as inactive history rather than started locally.

For local background jobs, set `INNGEST_DEV=1` in `.env.local`, run `pnpm dev`, and start `npx inngest-cli@latest dev --host 127.0.0.1 --no-discovery -u http://localhost:3003/api/inngest`. The dashboard is at http://127.0.0.1:8288. Production requires separate Inngest Cloud event/signing keys and a sync of `/api/inngest`; the local dev server does not configure production.
