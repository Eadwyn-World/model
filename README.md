# Eadwyn AI Model

**An open, federated mind.** A digital mind grown by everyone: weights, code and
training recipes are public; Catalyst Pods, homes and devices train it locally;
only learning travels; every merge is reviewed through governance.

This repository is the platform behind that idea, as one monorepo with several
deployable services and one set of typed contracts. It is a first milestone:
the architecture, the contracts, the service skeletons, a mock node runtime and
the public **AI Model** page are real and run end to end; the machine learning
is mocked behind clearly marked seams.

- **Philosophy** → [`docs/philosophy.md`](docs/philosophy.md) (drawn from *The World of Eadwyn*)
- **Architecture** → [`docs/architecture/overview.md`](docs/architecture/overview.md)
- **Node roles** → [`docs/architecture/node-roles.md`](docs/architecture/node-roles.md)
- **Decisions** → [`docs/decisions/`](docs/decisions/)

## Quick start

Requirements: Node 22.12+ and pnpm 10 (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm dev            # coordinator, aggregator, governance, inference edge and the web app
```

Then open <http://localhost:3000>. The federation panel reads live data from the
coordinator; if the coordinator is down the page renders a built-in snapshot and
says so.

Run one federated training round against the running stack:

```bash
pnpm demo:round
```

Three mock nodes register, train locally, submit signed updates; the aggregator
proposes a merge; two reviewers approve; the coordinator publishes the next
version and opens the next round. Reload the page and the readout has changed.

No `.env` is needed. Every variable has a schema and a working default; see
[`.env.example`](.env.example) and each app's own `.env.example`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | every app in watch mode (Turborepo) |
| `pnpm dev:services` | the four backend services only |
| `pnpm dev:web` | the web app only (renders the snapshot when services are down) |
| `pnpm demo:round` | one federated round, end to end, against the local services |
| `pnpm check` | lint + type-check + tests |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm build` | bundles each service to `dist/` (tsup) and builds the web app (Next) |
| `pnpm start:services` | runs the built service bundles |

## Ports and services

| Service | Port | Purpose |
| --- | --- | --- |
| `apps/web` | 3000 | the AI Model page |
| `apps/coordinator` | 4101 | node registry, training rounds, global model version, `GET /v1/stats` |
| `apps/aggregator` | 4102 | receives signed updates, validates them, proposes merge candidates |
| `apps/governance` | 4103 | pending merges, reviewer decisions, quorum, publish on approval |
| `apps/inference-edge` | 4104 | health, served model metadata, mock inference |

A few endpoints to poke at once the stack is up:

```bash
curl localhost:4101/v1/stats                 # the federation readout
curl localhost:4103/v1/merges                # merges waiting for review
curl localhost:4103/v1/decisions             # the decision log
curl -X POST localhost:4104/v1/infer -H 'content-type: application/json' \
     -d '{"prompt":"How does the mind rebalance?"}'
```

## Repository layout

```
├─ .github/
│  └─ workflows/
│     └─ ci.yml
├─ apps/  # deployables (one process each)
│  ├─ aggregator/  # Hono · signed updates → merge candidates (4102)
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ aggregator.test.ts
│  │  │  ├─ domain/
│  │  │  │  ├─ merge.ts
│  │  │  │  └─ validate.ts
│  │  │  ├─ app.ts
│  │  │  ├─ env.ts
│  │  │  ├─ index.ts
│  │  │  └─ state.ts
│  │  ├─ .env.example
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ tsup.config.ts
│  ├─ coordinator/  # Hono · registry, rounds, model version, /v1/stats (4101)
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ coordinator.test.ts
│  │  │  ├─ domain/
│  │  │  │  ├─ nodes.ts
│  │  │  │  ├─ rounds.ts
│  │  │  │  └─ stats.ts
│  │  │  ├─ app.ts
│  │  │  ├─ env.ts
│  │  │  ├─ index.ts
│  │  │  └─ state.ts
│  │  ├─ .env.example
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ tsup.config.ts
│  ├─ governance/  # Hono · review queue, decisions, quorum (4103)
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ governance.test.ts
│  │  │  ├─ domain/
│  │  │  │  └─ review.ts
│  │  │  ├─ app.ts
│  │  │  ├─ env.ts
│  │  │  ├─ index.ts
│  │  │  └─ state.ts
│  │  ├─ .env.example
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ tsup.config.ts
│  ├─ inference-edge/  # Hono · health, served model, mock inference (4104)
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ inference-edge.test.ts
│  │  │  ├─ app.ts
│  │  │  ├─ env.ts
│  │  │  ├─ index.ts
│  │  │  └─ mock-inference.ts
│  │  ├─ .env.example
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ tsup.config.ts
│  └─ web/  # Next.js · the AI Model page (port 3000)
│     ├─ src/
│     │  ├─ app/
│     │  │  ├─ api/
│     │  │  │  └─ federation/
│     │  │  │     └─ route.ts
│     │  │  ├─ globals.css
│     │  │  ├─ icon.svg
│     │  │  ├─ layout.tsx
│     │  │  └─ page.tsx
│     │  ├─ components/
│     │  │  ├─ contribute.module.css
│     │  │  ├─ contribute.tsx
│     │  │  ├─ federation-panel.module.css
│     │  │  ├─ federation-panel.tsx
│     │  │  ├─ hero.module.css
│     │  │  ├─ hero.tsx
│     │  │  ├─ learning-loop.module.css
│     │  │  ├─ learning-loop.tsx
│     │  │  ├─ philosophy.module.css
│     │  │  ├─ philosophy.tsx
│     │  │  ├─ principles.module.css
│     │  │  ├─ principles.tsx
│     │  │  ├─ site-footer.module.css
│     │  │  ├─ site-footer.tsx
│     │  │  ├─ site-header.module.css
│     │  │  └─ site-header.tsx
│     │  ├─ content/
│     │  │  └─ ai-model.ts
│     │  └─ lib/
│     │     ├─ env.ts
│     │     └─ federation.ts
│     ├─ .env.example
│     ├─ next.config.ts
│     ├─ package.json
│     └─ tsconfig.json
├─ docs/  # architecture, node roles, philosophy, decisions
│  ├─ architecture/
│  │  ├─ node-roles.md
│  │  └─ overview.md
│  ├─ decisions/
│  │  ├─ 0001-monorepo.md
│  │  └─ 0002-source-exported-packages.md
│  └─ philosophy.md
├─ packages/  # libraries (export TypeScript source)
│  ├─ federation-sdk/  # typed client for all services
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ client.test.ts
│  │  │  ├─ client.ts
│  │  │  ├─ http.ts
│  │  │  ├─ index.ts
│  │  │  └─ wait.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ knowledge-index/  # knowledge items with provenance + seed
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ index.test.ts
│  │  │  ├─ index.ts
│  │  │  ├─ seed.ts
│  │  │  └─ types.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ model-registry/  # current version, publish, history (JSON)
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ registry.test.ts
│  │  │  ├─ index.ts
│  │  │  ├─ registry.ts
│  │  │  └─ seed.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ service-kit/  # JSON store, env, Hono app factory, logger
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ json-store.test.ts
│  │  │  ├─ app.ts
│  │  │  ├─ best-effort.ts
│  │  │  ├─ env.ts
│  │  │  ├─ errors.ts
│  │  │  ├─ index.ts
│  │  │  ├─ json-store.ts
│  │  │  ├─ logger.ts
│  │  │  ├─ server.ts
│  │  │  └─ validation.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ shared-protocol/  # zod schemas + types for every contract; /signing, /fixtures
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ schemas.test.ts
│  │  │  ├─ api.ts
│  │  │  ├─ canonical.ts
│  │  │  ├─ federation.ts
│  │  │  ├─ fixtures.ts
│  │  │  ├─ governance.ts
│  │  │  ├─ index.ts
│  │  │  ├─ merge.ts
│  │  │  ├─ model.ts
│  │  │  ├─ node.ts
│  │  │  ├─ primitives.ts
│  │  │  ├─ prng.ts
│  │  │  ├─ signing.ts
│  │  │  ├─ training.ts
│  │  │  └─ version.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  ├─ training-runtime/  # mock local node: register → prepare → submit
│  │  ├─ src/
│  │  │  ├─ __tests__/
│  │  │  │  └─ node.test.ts
│  │  │  ├─ index.ts
│  │  │  ├─ mock-training.ts
│  │  │  └─ node.ts
│  │  ├─ package.json
│  │  └─ tsconfig.json
│  └─ ui/  # tokens, base styles, lattice/root motifs, primitives
│     ├─ src/
│     │  ├─ button.tsx
│     │  ├─ format.ts
│     │  ├─ index.ts
│     │  ├─ lattice.tsx
│     │  ├─ root-lines.tsx
│     │  ├─ section.tsx
│     │  └─ wordmark.tsx
│     ├─ styles/
│     │  ├─ base.css
│     │  └─ tokens.css
│     ├─ package.json
│     └─ tsconfig.json
├─ scripts/  # demo-round.ts — one federated round end to end
│  └─ demo-round.ts
├─ .editorconfig
├─ .env.example
├─ .gitignore
├─ .npmrc
├─ biome.json
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ tsconfig.json
└─ turbo.json
```

`apps/*` are deployables; `packages/*` are libraries. Apps depend on packages,
packages never depend on apps, and `shared-protocol` depends on nothing but zod.
Packages export TypeScript source (no build step); services run with `tsx` in
development and bundle with `tsup` for production. See ADR
[0001](docs/decisions/0001-monorepo.md) and [0002](docs/decisions/0002-source-exported-packages.md).

## How a round works

1. A node registers with the coordinator (`registerNode`), sending its Ed25519
   public key; registration is idempotent on the key.
2. It trains locally and prepares a `TrainingUpdate`: a content-addressed
   reference to its delta, metrics, the knowledge items it learned from, and a
   signature over the canonical JSON. Data never leaves the node.
3. The aggregator validates the shape and the semantics (size, replay, one
   update per node per round, signature against the coordinator's registry),
   stores the reference and reports progress.
4. `POST /v1/merges` folds the round into a `MergeCandidate` (mock aggregation)
   and forwards it to governance.
5. Reviewers record decisions with rationales. At quorum the candidate is
   approved and governance asks the coordinator to publish.
6. The coordinator publishes the next version, closes the round and opens a new
   one on the new base. The page's readout changes.

Every request and response crosses the boundary through schemas in
`@eadwyn/shared-protocol`; services validate inbound bodies and the SDK
validates responses, so a contract change breaks both sides at type-check time.

## Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT`, `HOST` | per app (`4101`…`4104`, `3000`; `0.0.0.0`) | every app |
| `DATA_DIR` | `./data` | services (one seeded JSON file each, git-ignored) |
| `LOG_FORMAT`, `LOG_LEVEL` | `pretty`, `info` | services |
| `COORDINATOR_URL`, `AGGREGATOR_URL`, `GOVERNANCE_URL`, `INFERENCE_EDGE_URL` | `http://localhost:41xx` | aggregator, governance, web, SDK, demo |
| `COORDINATOR_EXPECTED_NODES`, `COORDINATOR_ONLINE_WINDOW_MINUTES` | `128`, `360` | coordinator |
| `AGGREGATOR_VERIFY_SIGNATURES`, `AGGREGATOR_MAX_DELTA_BYTES` | `true`, `64 MiB` | aggregator |
| `GOVERNANCE_APPROVAL_QUORUM`, `GOVERNANCE_REJECTION_QUORUM` | `2`, `1` | governance |
| `EADWYN_DATA_SOURCE` | `auto` (`mock` / `live`) | web |
| `NEXT_PUBLIC_SOURCE_URL` | this repository | web |

## Testing

`pnpm test` runs Vitest per package: schema and signing tests for
`shared-protocol`, store/registry/index/SDK/runtime tests for the packages, and
one route-level test file per service (the Hono app is exercised in-process
with `app.request`, against a temporary data directory). CI
(`.github/workflows/ci.yml`) runs lint, type-check, tests and the full build.

## What is mocked, and where the seams are

| Mocked today | Seam |
| --- | --- |
| local training | `simulateLocalTraining` in `packages/training-runtime` |
| aggregation | `buildMergeCandidate` in `apps/aggregator/src/domain/merge.ts` |
| inference | `mockInfer` in `apps/inference-edge` (responses carry `mock: true`) |
| artifact storage | deltas and checkpoints are referenced by URI + sha256; no bytes move |
| persistence | `createJsonStore` in `packages/service-kit` (swap for SQLite/Postgres behind the same interface) |
| reviewer identity | `reviewerId` is a string; authentication is a later layer |
| edge sync | the inference edge serves its own registry copy; pulling published versions is the next milestone |

## Open questions for maintainers

- **License.** The code is meant to be open source, but no `LICENSE` file has
  been added yet; choosing one (Apache-2.0 is the model versions' declared
  license in the seed data) is a maintainer decision.
- **Reviewer authentication and node admission** are the next governance steps.
