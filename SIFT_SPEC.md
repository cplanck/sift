# Sift --- Product & Technical Specification

**Status:** Implementation handoff\
**Product thesis:** **Sift is your personal cookbook that you can talk
to.**

## 1. Product principles

### Agent-first, not agent-only

Sift's assistant is a first-class interface. High-entropy operations
belong naturally in the assistant; conventional UI remains first-class
for browsing and simple deterministic actions.

Examples: - Direct UI: search `tu` → Turkey Chili; favorite; check an
ingredient; upload a photo. - Agent: "Change this to serve six and use
thighs"; "What should we cook this week?"; "Build a grocery list from
these recipes and what I already have."

### One page-aware assistant

There is one user-facing Sift assistant, not
recipe/cooking/grocery/planning agents. Each invocation receives
deterministic context: authenticated user, workspace, route/surface,
active recipe/version, active cooking session, and relevant
conversation.

### Rich model, lightweight interaction

Recipes, versions, cooking sessions, notes, grocery lists, meal plans,
conversations, and workspaces can be durable entities without becoming
top-level destinations.

### Minimize surfaces

The primary surface is **Library**. The primary capability is **Sift**.
Prefer contextual states and artifacts over new tabs.

### Read-oriented, agentic write interface

Recipes are calm, beautiful, read-oriented artifacts. Avoid a large
admin CRUD editor. Substantive editing happens primarily through Sift;
direct correction remains available where faster.

### Low entropy stays deterministic

Do not invoke an LLM for search prefixes, filtering, sorting, favorites,
checkboxes, deterministic scaling, or ordinary CRUD.

------------------------------------------------------------------------

## 2. V1 scope

Include authentication; workspace-ready tenancy; recipe library; instant
deterministic search; structured recipes; ingestion via MCP, paste, URL,
and image/photo; R2 photos; recipe versions and notes; optional Cooking
Sessions; cooking mode/history; one persistent page-aware assistant;
text chat; ElevenLabs realtime voice; grocery-list and meal-plan
artifacts; unlisted sharing; PWA/installability; useful offline recipe
access; MCP; Inngest jobs; and responsive phone/iPad/desktop UI.

Explicitly exclude pantry/inventory, nutrition/macros, social feeds,
public discovery, grocery-store integrations, purchasing, realtime
collaboration/presence, native apps, analytics dashboards, vector
databases, unnecessary RAG infrastructure, wake words, and elaborate
offline-first synchronization.

------------------------------------------------------------------------

## 3. Stack

-   Next.js App Router, TypeScript strict mode, Vercel, pnpm.
-   Tailwind + shadcn/ui + Lucide + Inter.
-   Neon Postgres + Drizzle; migrations committed to Git.
-   Better Auth.
-   Cloudflare R2 for objects.
-   Inngest through `/api/inngest`.
-   Vercel AI SDK stable tool-loop agent abstraction; do not hand-roll
    the fundamental agent loop.
-   Vercel AI Gateway as the primary gateway; Anthropic initially;
    centralized provider/model registry.
-   ElevenLabs realtime speech/WebRTC integration.
-   Zod at external/tool boundaries.
-   Vitest + Playwright.

------------------------------------------------------------------------

## 4. Brand and UI

Use **Sift**, visually preferably lowercase `sift`.

Dark-mode-first but respect system preference. Near-black, white,
neutral grays, restrained intentional color, food photography providing
most incidental color, Inter, generous spacing, strong hierarchy,
minimal chrome, accessible components, responsive phone/iPad/desktop.

Avoid AI visual tropes: no sparkle/bedazzle icon, purple/blue AI
gradients, neon borders, glowing orbs, rainbow gradients, gratuitous
colored pills, robot icons, excessive glassmorphism, or ubiquitous "AI"
badges.

Use Lucide for standard actions. Create a custom flat monochrome Sift
mark that works at 16×16 and scales to PWA/app icons. Produce favicon,
Apple touch icon, standard PWA icons, and maskable icons.

------------------------------------------------------------------------

## 5. Information architecture

### Library

Default authenticated surface: - Sift logo/wordmark - instant recipe
search - recent/favorite/filter states as useful - recipe grid/list -
global Sift control - user/settings menu

Do not create permanent tabs for Grocery, Plan, History, Collections, or
Cook in v1.

### Search

Deterministic and immediate. Suggested ranking: 1. exact title 2. title
prefix 3. title substring 4. tags/collections 5. ingredients 6.
description/notes

Use Postgres full-text/trigram capabilities as appropriate. No vector
DB.

### Global assistant

A restrained persistent Sift control, conceptually an expanding
dot/brand mark rather than an AI sparkle. Desktop/iPad should preserve
page context with a panel/overlay. Phone may use a full-screen
assistant.

------------------------------------------------------------------------

## 6. Tenancy

Support many-to-many User ↔ Workspace through `workspace_members`, while
V1 UX remains effectively single-workspace.

On signup: create user → personal cookbook workspace → owner membership
→ active workspace.

Domain content belongs to `workspace_id`, not directly to a user. Retain
`created_by_user_id` / `updated_by_user_id` where useful.

Every server operation derives the authenticated user, verifies
membership, and scopes by workspace. Never treat client-supplied
workspace IDs as authorization.

Do not build workspace switching, invitations, member management,
collaboration UI, or complex roles in V1.

------------------------------------------------------------------------

## 7. Recipe model

Canonical Recipe supports title, description, servings/yield,
prep/cook/optional total time, draft/active/archived status, source
type, source URL/name, current version, cover photo, timestamps, and
provenance.

Support ingredient sections and instruction sections.

Ingredient representation must preserve original human text plus
optional normalized structure. Do not assume quantity is one float.
Support `½ cup`, `2–3 tbsp`, `1 14-oz can`, `to taste`, and
`2 large eggs`. Preserve original representation even when normalization
succeeds.

------------------------------------------------------------------------

## 8. Versions and notes

Substantive canonical changes create immutable Recipe Versions. Cooking
Sessions reference the exact version used. Support history and
restoration.

Recipe Notes are first-class observations not necessarily incorporated
into the canonical recipe. Cooking-session notes belong to one cook.

Semantic rule: - "This needed more salt" → observation/note by
default. - "Change this recipe to 1½ tsp salt" → canonical
update/version.

The assistant can later synthesize notes/history into a deliberate
canonical update.

------------------------------------------------------------------------

## 9. Cooking Sessions

A Recipe is canonical knowledge; a Cooking Session is one instance of
making it.

Store recipe/version, workspace, starter, timestamps, status
(active/completed/abandoned), servings, optional rating/summary, notes,
photos, and progress where useful.

Opening a recipe never creates a session. `Cook` may create one and
enter cooking mode. The agent may create one when intent is explicit
("I'm making this now"). Finishing is lightweight and all wrap-up fields
are optional.

Session photos remain distinct from canonical recipe photos.

------------------------------------------------------------------------

## 10. Cooking mode

A contextual state of the recipe surface, not navigation.

Optimize for phone/iPad on a counter: large type, high contrast, minimal
controls, optional ingredient/step checkoff, current-step emphasis, wake
lock where supported, prominent voice access, and resilience to
intermittent connectivity.

The assistant receives active recipe, exact version, active session, and
cooking progress. Cooking responses default concise and actionable.

------------------------------------------------------------------------

## 11. Ingestion and editing

Support MCP, pasted text, URL, and image/photo ingestion. All converge
on: raw input → extraction → canonical schema → validation → lightweight
review → obvious corrections → save.

Imports remain drafts until approved. Preserve provenance. Treat
imported web/text content as untrusted data, never model instructions.

Do not build a giant recipe editor. Sift is the primary substantive
editing interface. Examples: rename, change ingredient amount, alter
servings, rewrite instructions, or incorporate lessons from previous
cooks.

Allow lightweight direct manipulation where clearly faster, especially
import/OCR correction, cover photo, favorite, and trivial deterministic
controls.

------------------------------------------------------------------------

## 12. Assistant runtime

Use the Vercel AI SDK stable tool-loop abstraction and build a thin
application-owned `AssistantRuntime` for authentication, workspace
resolution, page context, conversation persistence, contextual
instructions, dynamic tool selection, authorization, model selection,
credentials, and streaming.

Conceptual context:

``` ts
interface AppContext {
  userId: string
  workspaceId: string
  route: string
  surface: "library" | "recipe" | "cooking" | "conversation" | "artifact"
  activeRecipeId?: string
  activeRecipeVersionId?: string
  activeCookingSessionId?: string
  activeArtifactId?: string
}
```

Supply obvious page context deterministically. Text and voice should
share the same conceptual assistant/conversation state.

------------------------------------------------------------------------

## 13. Domain and agent tools

UI, assistant, MCP, and jobs use the same authenticated,
workspace-scoped domain service layer. Agent tools must not implement
parallel persistence logic.

Capabilities should cover recipe
search/get/create/update/archive/version/restore/notes; cooking
start/get/complete/notes/history/photos; favorites/tags/collections;
grocery-list create/get/add/remove/check/derive; and meal-plan
create/get/add/remove.

Mutation policy: - trivial/reversible actions may execute immediately
and report success - destructive actions require confirmation - large
transformations communicate changes and remain recoverable through
version history

Any meaningful high-entropy user operation should generally be
expressible through Sift.

------------------------------------------------------------------------

## 14. Voice

Voice is another transport into Sift, not another agent.

Requirements: ElevenLabs realtime integration; tap once to begin;
visible listening/thinking/speaking states; low latency; natural
turn-taking; barge-in; no wake word; explicit end; transcript available
but secondary in cooking mode; graceful reconnect/error handling; text
fallback; clear microphone permission UX; normal-browser and
installed-PWA support where platform capabilities permit.

Cooking mode should make voice particularly prominent.

------------------------------------------------------------------------

## 15. Grocery and meal-plan artifacts

These are durable structured artifacts, not destinations.

They may be created through Sift and rendered inline in conversation or
opened as focused temporary views. Grocery artifacts support
grouped/checkable items plus copy/share/open-list actions. Persist them
so they survive closing the app.

Do not build pantry inventory.

Meal plans similarly persist and may surface contextually in Library
when useful, but no permanent Plan tab.

------------------------------------------------------------------------

## 16. Sharing

Private by default. Support explicit `Share → Create link` producing an
unlisted read-only URL.

No public/indexable discovery in V1.

Shared pages require no authentication, are
polished/responsive/read-only, include good OpenGraph metadata, and
expose images through a controlled access strategy.

------------------------------------------------------------------------

## 17. Photos / R2

Support multiple canonical recipe photos, one cover photo,
cooking-session photos, upload progress/error state, client-side
resizing/compression where appropriate, workspace-scoped object keys,
and server-authorized uploads. Do not store large binaries in Postgres.

------------------------------------------------------------------------

## 18. PWA

PWA from V1: - valid manifest - standalone installability -
favicon/touch/maskable icon set - correct theme/background metadata -
iOS/iPad safe areas - portrait phone and landscape iPad support -
controlled service worker/update strategy - offline indicator - app
shell/static asset caching - best-effort local availability of
recently/opened recipes and required cooking imagery/data

Do not blindly cache authenticated APIs. Do not build complex offline
synchronization.

Service worker handles browser/PWA concerns; Inngest handles server-side
durable work.

------------------------------------------------------------------------

## 19. MCP

Expose an authenticated MCP server as another interface to the same
domain layer.

Initial MCP capabilities should prioritize recipe
create/search/get/update so an external Claude/Codex conversation can
say "save this to Sift."

MCP never bypasses workspace authorization and must not become a
parallel implementation.

------------------------------------------------------------------------

## 20. AI credentials

Support an application-level Vercel AI Gateway credential through Vercel
environment variables.

Also architect optional per-user Gateway credentials so another user can
BYOK.

Never store plaintext credentials on `users`. Use a separate encrypted
credential entity with provider, encrypted secret, masked hint, and
timestamps. Encryption key lives only in server environment
configuration. Secrets are never returned after creation, logged, placed
in model context, tool output, MCP responses, or errors.

Credential resolution: user credential if configured → application
Gateway credential fallback.

Credential ownership is user-level, not workspace-level.

------------------------------------------------------------------------

## 21. Background jobs

Use Inngest for durable work such as URL imports, heavier image/import
processing, retries, and other asynchronous workflows. Do not introduce
Redis/Celery or another queue in V1.

------------------------------------------------------------------------

## 22. Optimistic UI and states

Use optimistic UI by default for appropriate deterministic mutations,
with rollback on failure.

Implement deliberate: - skeleton/loading states - empty cookbook - empty
search - failed upload - failed AI response - voice disconnected -
offline - API/database errors - optimistic rollback

Use toasts sparingly.

------------------------------------------------------------------------

## 23. Security

The browser is untrusted.

Requirements: - server-derived authentication - workspace membership
checks on every domain operation - no authorization from
model/client-supplied IDs alone - server-only provider secrets -
encrypted BYOK secrets - signed/authorized R2 operations - validation of
tool arguments - rate limiting for expensive AI/voice endpoints where
appropriate - imported content treated as untrusted data -
prompt-injection boundaries around URL/text imports - authenticated
MCP - no secret leakage through logs/errors

------------------------------------------------------------------------

## 24. Architecture discipline

Prefer a structure with explicit domain/service boundaries,
e.g. `src/domain`, `src/services`, `src/ai`, `src/db`, `src/app`, with
exact naming adjusted sensibly during implementation.

Rules: - Drizzle schema authoritative - migrations in Git - consistent
UUID strategy - UTC timestamps - foreign keys and useful workspace
indexes - transactions for multi-entity operations - no direct DB access
from React components - no direct DB access from agent/MCP tool
definitions - tools call domain services - environment variables
validated centrally - model identifiers centralized - ElevenLabs
voice/model config centralized - avoid premature abstractions and
infrastructure

No infrastructure should incur meaningful fixed cost at idle where
avoidable.

------------------------------------------------------------------------

## 25. Logging

Use Vercel/application structured logging plus Inngest/ElevenLabs
operational visibility. Do not add an analytics/observability SaaS in
V1.

Log useful correlation identifiers where available (request, user,
workspace, conversation, recipe, cooking session, job run) without
unnecessarily dumping recipe content, prompts, credentials, or sensitive
data.

------------------------------------------------------------------------

## 26. Testing

Vitest should cover domain services, recipe scaling/parsing logic,
authorization/workspace isolation, versioning, and agent tools.

Playwright should cover at minimum: - sign in - initial personal
workspace - create/import recipe - recipe search - agent edit - recipe
version creation - start/finish cooking - note/photo flow as practical -
grocery artifact - unlisted share link - responsive/mobile navigation -
critical PWA behavior where testable

Workspace isolation tests are mandatory: User A must never retrieve User
B's workspace content by guessing IDs.

------------------------------------------------------------------------

## 27. Accessibility and responsive quality

Use semantic HTML, keyboard navigation, visible focus, accessible
dialogs/sheets, correct labels, sufficient contrast, touch-friendly
targets, reduced-motion respect, and screen-reader-friendly controls.

Treat iPhone, iPad, and desktop as first-class. Avoid desktop layouts
merely squeezed onto mobile.

------------------------------------------------------------------------

## 28. Implementation milestones

### M0 --- Foundation

Next.js, TypeScript, lint/typecheck/test/build, Tailwind/shadcn, theme,
brand shell, PWA foundation, environment validation.

### M1 --- Persistence/auth

Neon/Drizzle, Better Auth, User/Workspace/Membership, authorization
primitives, personal-workspace bootstrap.

### M2 --- Recipe domain

Recipe schema, versions, notes, deterministic search, domain services,
basic Library and recipe views.

### M3 --- Ingestion/media/sharing

Paste/image/URL ingestion, R2, import review, source provenance,
unlisted sharing.

### M4 --- Assistant

AI Gateway/model registry, AssistantRuntime, conversation persistence,
page context, core recipe tools, global assistant UI.

### M5 --- Cooking

Cooking Sessions, cooking mode, session notes/photos/history, offline
recipe resilience/wake lock where supported.

### M6 --- Artifacts

Grocery-list and meal-plan entities/tools and contextual artifact
rendering without new permanent navigation.

### M7 --- Voice

ElevenLabs realtime integration, barge-in, cooking-mode voice UX,
fallback/reconnect.

### M8 --- MCP

Authenticated MCP server using the same domain services.

### M9 --- Polish

Responsive/iPad/PWA QA, accessibility, loading/error states, security
review, tests, performance, deployment validation.

Milestones may be adjusted when implementation reality requires it, but
architectural deviations must be documented.

------------------------------------------------------------------------

## 29. Implementation tracking

Maintain `IMPLEMENTATION.md` with: - current milestone - completed
work - architectural decisions - deviations from this spec and
rationale - unresolved issues - required manual/provider configuration -
next steps

Do not silently diverge from this specification.

------------------------------------------------------------------------

## 30. Definition of Done

Sift is done for V1 when a user can: 1. deploy and authenticate 2.
receive a personal cookbook workspace 3. add recipes via practical
ingestion paths 4. browse and instantly search the Library 5. open a
polished recipe 6. ask Sift questions about the current recipe or entire
cookbook 7. modify recipes through Sift with version history 8.
optionally start/finish a Cooking Session 9. add observations/photos to
a cook 10. use cooking mode on phone/iPad 11. converse with Sift through
realtime voice where supported 12. create durable grocery/meal-plan
artifacts through the assistant 13. create an unlisted read-only recipe
share link 14. use an external MCP client for core recipe operations 15.
install Sift as a PWA 16. reopen a previously accessed recipe with
useful offline resilience

Before handoff, these must pass:

``` bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

No knowingly dead controls, placeholder production paths, fake
integrations, or unresolved TODO implementations should remain in the
completed milestone set.

If a provider credential or external setup prevents a feature from being
exercised, implement the real integration path, fail clearly when
configuration is absent, document the exact required setup in
`IMPLEMENTATION.md`, and do not replace it with a fake production
implementation.
