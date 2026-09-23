# ADR 0002: Internal packages export TypeScript source

**Status:** accepted · **Date:** 2026-09-23

## Context

Workspace packages can either be built to `dist/` with declarations and consumed
as compiled JavaScript, or export their `.ts` source and be compiled by whoever
consumes them. The first needs a build step before `pnpm dev` works and a watcher
per package during development; the second needs every consumer to know how to
compile TypeScript.

## Decision

Internal packages export source (`"exports": { ".": "./src/index.ts" }`) and
have no build step.

- Services run with `tsx` in development and bundle with `tsup` for production;
  the bundle includes the workspace packages, so `dist/` runs with plain `node`.
- The web app lists the packages in `transpilePackages`; Next compiles them.
- Vitest and `tsc` resolve the source directly.

## Consequences

- `pnpm install && pnpm dev` works with no build; editing a package is picked up
  by every consumer immediately.
- Each consumer type-checks the package sources it imports. This is slower than
  consuming declarations but keeps one source of truth.
- Node-only code that must not reach the browser lives behind explicit subpaths
  (`@eadwyn/shared-protocol/signing`) rather than in the package root.
- If a package is ever published outside the workspace, it will need a build;
  that is the moment to add one, not before.
