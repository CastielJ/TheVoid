## What does this change?

<!-- A concise description of what changed and why. Link the issue it resolves, if any (e.g. "Fixes #123"). -->

## How was this tested?

<!-- pnpm typecheck / lint / test all pass locally? New tests added? Manually verified in a browser? -->

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm --filter @void/web test:e2e` passes (if this touches frontend or API surface it exercises)
- [ ] New/updated tests cover the change, including the authorization path if it touches who-can-access-what

## Schema changes

<!-- If this touches packages/server/src/db/schema.ts: -->

- [ ] N/A — no schema change
- [ ] Migration generated via `pnpm db:generate` (never hand-edited)
- [ ] Migration is scoped to this one logical change, not batched with others

## Screenshots

<!-- For any UI change, a before/after screenshot or short clip makes review much faster. -->
