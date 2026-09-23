# Architecture overview

One repository, several deployable services, one set of typed contracts. The
platform is the software side of a simple loop:

> Nodes learn locally. Learning travels. The mind rebalances.

Read [`../philosophy.md`](../philosophy.md) for why it is shaped this way.

## The pieces

```
                 ┌──────────────────────┐
   register /    │      coordinator     │  node registry · rounds · model registry
   heartbeat ───▶│      :4101           │◀─── publish approved merge
                 └──────────┬───────────┘
                            │ round progress (best-effort)
   signed update ┌──────────▼───────────┐        ┌──────────────────────┐
   ─────────────▶│      aggregator      │───────▶│      governance      │
                 │      :4102           │ merge  │      :4103           │
                 └──────────────────────┘ cand.  └──────────────────────┘
                                                   reviewers approve/reject
                 ┌──────────────────────┐        ┌──────────────────────┐
   public reads  │    inference-edge    │        │         web          │
   ─────────────▶│      :4104           │        │        :3000         │
                 └──────────────────────┘        └──────────────────────┘
                   serves published model         AI Model page + live readout
```

| Deployable | Owns | Never does |
| --- | --- | --- |
| `apps/coordinator` | node registry, training rounds, the canonical model registry, the federation readout (`GET /v1/stats`) | see data, decide merges |
| `apps/aggregator` | accepted updates, merge candidates | publish anything |
| `apps/governance` | the pending queue, the decision log, quorum | train, aggregate |
| `apps/inference-edge` | the served copy of the model, health, mock inference | take part in training |
| `apps/web` | the public AI Model page | hold state |

| Package | What it is |
| --- | --- |
| `packages/shared-protocol` | zod schemas + TypeScript types for every contract; canonical JSON; Ed25519 signing (`/signing`); deterministic fixtures (`/fixtures`) |
| `packages/service-kit` | JSON file store, env loading, Hono app factory, logger, validators, best-effort helper |
| `packages/model-registry` | current version, publish, history; JSON-backed |
| `packages/training-runtime` | the mock local node: `registerNode()`, `prepareLocalUpdate()`, `submitUpdate()` |
| `packages/knowledge-index` | contributed knowledge items with provenance, seeded from the world |
| `packages/federation-sdk` | typed HTTP client for all four services; validates responses |
| `packages/ui` | design tokens, base styles, lattice/root motifs, a few primitives |

## One round, end to end

1. A node registers with the coordinator, sending its Ed25519 public key. The
   coordinator assigns a `nodeId` (idempotent on the key) and returns the active
   round and its base version.
2. The node trains locally and produces a `TrainingUpdate`: a content-addressed
   reference to its delta, metrics, the knowledge items it learned from, and a
   signature over the canonical JSON of all of that.
3. The aggregator validates the shape, then the semantics: delta size, no
   replay, one update per node per round, and the signature against the public
   key it fetches from the coordinator. It stores the reference and reports
   progress to the coordinator (best-effort).
4. `POST /v1/merges` folds a round's updates into a `MergeCandidate` (mock
   aggregation: metrics combined per method, checkpoint hash derived from the
   update digests) and forwards it to governance (best-effort).
5. Reviewers post decisions. When approvals reach the quorum the candidate is
   approved and governance asks the coordinator to publish it (best-effort;
   failures are recorded on the review, never hidden).
6. The coordinator publishes the next minor version, marks the round published,
   closes any other open round (its base is now stale) and opens a new round on
   the new version. The web page's readout changes.

`pnpm demo:round` runs exactly this against the local stack.

## Contracts at the boundary

Every request body is validated with a schema from `@eadwyn/shared-protocol`
before a handler sees it, and every SDK response is validated with the same
schemas before a caller sees it. A change to a contract fails type-checking on
both sides. Errors share one envelope: `{ error: { code, message, details? } }`.

## Persistence

Each service keeps one JSON file under `DATA_DIR` (default `./data`, seeded on
first run, git-ignored). `createJsonStore` in `service-kit` gives atomic writes
and serialised mutations behind a three-method interface (`read`, `update`,
`reset`). Swapping it for SQLite or Postgres means re-implementing that
interface, not touching routes. Run one instance per data directory.

## Configuration

Every variable has a schema and a working default (`src/env.ts` in each app), so
a fresh clone runs with no `.env`. A `.env` file in the app directory is applied
without overriding the shell. Service discovery is four URLs:
`COORDINATOR_URL`, `AGGREGATOR_URL`, `GOVERNANCE_URL`, `INFERENCE_EDGE_URL`.

## The web page

`apps/web` is a Next.js app. The page is server-rendered from
`getFederationSnapshot()`, which asks the coordinator and governance through the
SDK with a short timeout and falls back to the fixtures snapshot (and says so)
when the coordinator is unreachable. The live panel is a client component that
polls `GET /api/federation` (a route handler that returns the same snapshot) every
fifteen seconds, so service URLs stay server-side and no CORS is involved.

## What is deliberately not here yet

- Real training and real aggregation. The seams are `simulateLocalTraining` and
  `buildMergeCandidate`.
- Artifact storage. Deltas and checkpoints are referenced by URI and hash; nothing
  moves bytes yet.
- Durable cross-service messaging. Signals are best-effort HTTP calls with logged
  failures; a queue comes when a lost signal would cost something.
- Reviewer identity. `reviewerId` is a string; authentication is a later layer.
- Edge sync. The inference edge serves its own registry copy; pulling published
  versions from the coordinator is the next milestone.
