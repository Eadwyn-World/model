# ADR 0001: One repository, multiple deployable services

**Status:** accepted · **Date:** 2026-09-23

## Context

The platform is several runtime responsibilities (coordinating rounds, receiving
updates, reviewing merges, serving inference, the public web surface) that share
one thing above all: the protocol. A `TrainingUpdate` produced by a node must be
exactly what the aggregator validates and what a reviewer sees. The project is
also early: the shape of every contract will change often, and it must stay
easy for a contributor to run everything on a laptop.

## Decision

Keep everything in one repository, split into packages with explicit
boundaries, and deploy the apps separately.

- **pnpm workspaces** for package linking and a single lockfile; versions of
  third-party dependencies are pinned once in the `catalog`.
- **Turborepo** for running `dev`, `build`, `test`, `typecheck` across packages
  with caching and dependency ordering.
- `apps/*` are deployables; `packages/*` are libraries. Apps depend on packages;
  packages never depend on apps; the protocol package depends on nothing but zod.
- One toolchain for the whole tree: TypeScript, Biome (lint + format), Vitest.

## Why not several repositories

- A contract change would land in five places, in five pull requests, and be
  wrong in one of them.
- Local development would need a compose file and published package versions
  before the first line of product code exists.
- Governance is easier when the whole system is one diff.

## Why not one service

The responsibilities have different trust levels (the aggregator must never
publish; governance must never train), different scaling shapes (the edge is
read-heavy and public; the aggregator is write-heavy and internal) and different
owners in a federation where other communities may run their own coordinator.
Separate deployables keep those lines visible.

## Consequences

- Each app builds to a self-contained bundle (`tsup`) and can ship in its own
  container; the web app builds with Next.
- Cross-service calls go through `@eadwyn/federation-sdk`, so there is one
  place to add auth, retries or tracing.
- The repo can later be split along package boundaries if a service outgrows it;
  nothing in the layout assumes it never will.
