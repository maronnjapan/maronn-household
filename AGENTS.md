# Repository Guidelines

## Project Structure & Module Organization
`apps/household-app/` is the Vike + React client. UI primitives live in `components/`, pages and transitions in `pages/`, RPC wiring in `trpc/`, and worker adapters under `server/`. Static assets belong to `assets/`, while feature-specific styles sit beside the owning page or component. Pure domain logic and value objects live in `packages/domain/`, with tests in `packages/domain/tests/`. Deployment helpers, database automation, and ops docs stay inside `scripts/`.

## Build, Test, and Development Commands
All commands run through pnpm:
- `pnpm dev` – launch the household app with hot reload.
- `pnpm build` – rebuild every workspace package before deploys.
- `pnpm lint`, `pnpm lint:fix`, `pnpm format` – enforce ESLint + Prettier.
- `pnpm typecheck` – run `tsc --noEmit` to surface typing regressions.
- `pnpm test`, `pnpm test:watch`, `pnpm test:e2e` – execute Vitest suites and Playwright specs.
- `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio` – manage Drizzle migrations/D1 schemas through the API worker.

## Coding Style & Naming Conventions
Codebase is fully TypeScript. Use 2-space indentation, trailing commas, and double quotes inside JSX. Components and hooks use PascalCase filenames (`RemainingDisplay.tsx`, `useAddExpense.ts`). Shared utilities favor named exports. CSS and asset files use kebab-case. Run `pnpm format` after touching Markdown or JSON to avoid CI noise.

## Testing Guidelines
Vitest powers unit, integration, and domain tests; co-locate specs as `<feature>.test.ts(x)` or place package-level suites in `packages/domain/tests/`. Keep a `pnpm test:watch` process running during TDD cycles and aim for >90% statement coverage in the domain package (`pnpm test -- --coverage`). UI and syncing happy-paths belong to Playwright and must run headless with `pnpm test:e2e` before major releases.

## Commit & Pull Request Guidelines
Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`) as in `git log`. Keep messages imperative and scoped. PRs must describe intent, list impacted areas, link any issue, and paste the command output for lint/test runs. UI-affecting changes should include screenshots or a short clip.

## Environment & Deployment Tips
Secrets belong in `.env*` files or Wrangler bindings—never commit them. Use `pnpm deploy`, `pnpm deploy:dev|prod|quick`, and `pnpm setup:d1` for Cloudflare Worker rollouts. When iterating on auth or data flows, rely on the Supabase helper scripts in `apps/household-app` (`pnpm --filter household-app supabase:start/stop`). Update `better-auth.config.ts` and `wrangler.jsonc` together whenever worker bindings change.
