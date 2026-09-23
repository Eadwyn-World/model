# Architecture overview

One repository, several deployable services, one set of typed contracts, two
runtimes (Node and Cloudflare Workers). The platform is the software side of a
simple loop:

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
| `apps/inference-edge` | the served copy of the model, inference (Workers AI, a Pod, or mock), the response cache | take part in training |
| `apps/web` | the public AI Model page | hold state |
| `apps/merge-runner` | large aggregation jobs, in a Cloudflare Container or on a Pod GPU | decide anything |

| Package | What it is |
| --- | --- |
| `packages/shared-protocol` | zod schemas + TypeScript types for every contract; canonical JSON; WebCrypto Ed25519 signing (`/signing`); object keys; deterministic fixtures (`/fixtures`) |
| `packages/service-kit` | the three-method document store (file, Durable Object, D1, memory), object storage (filesystem, R2, S3 API, presigned uploads), Hono app factory, caller and Access auth, env parsing, logger; Node-only helpers in `/node` |
| `packages/model-registry` | current version, publish (idempotent per merge), adopt, history; on any store backend |
| `packages/weights` | safetensors codec, FedAvg / median / trimmed-mean over float32 tensors, the verified aggregation job |
| `packages/training-runtime` | the mock local node: `registerNode()`, `prepareLocalUpdate()`, `submitUpdate()`; produces real adapter deltas |
| `packages/knowledge-index` | contributed knowledge items with provenance, seeded from the world |
| `packages/federation-sdk` | typed client for all four services over HTTP or service bindings; validates responses |
| `packages/ui` | design tokens, base styles, lattice/root motifs, a few primitives |

## One round, end to end

1. A node registers with the coordinator, sending its Ed25519 public key. The
   coordinator assigns a `nodeId` (idempotent on the key) and returns the active
   round and its base version.
2. The node trains locally (simulated) and gets a real adapter delta
   (safetensors). It asks the aggregator for an upload target, uploads the
   delta (straight to R2 with a presigned URL, or through the aggregator), and
   submits a `TrainingUpdate`: a content-addressed reference to that delta,
   metrics, the knowledge items it learned from, and a signature over the
   canonical JSON of all of that.
3. The aggregator validates the shape, then the semantics: delta size, the
   delta's location, no replay, one update per node per round, the signature
   against the public key it fetches from the coordinator, and that the stored
   bytes match the signed digest. It records the update and reports progress to
   the coordinator (directly on Node, through a Queue on Cloudflare).
4. An operator calls `POST /v1/merges`. The aggregator writes a manifest (which
   deltas, with which weights) and a pending candidate, then its pipeline
   (a Workflow on Cloudflare) aggregates the deltas with FedAvg (or median,
   trimmed mean), records the merged checkpoint and forwards the candidate to
   governance.
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

Services persist through a three-method document store (`read`, `update`,
`reset`) or, where queries matter, a small repository interface:

| Service | Node | Cloudflare |
| --- | --- | --- |
| coordinator | JSON files | a `Federation` Durable Object (nodes, rounds); D1 (version history) |
| governance | JSON file | a `MergeReview` Durable Object per candidate; D1 projection for listings |
| aggregator | JSON file + filesystem objects | D1 tables + R2 buckets |
| inference edge | JSON file | D1 (served registry) + KV (response cache) |

Local Node data lives under `DATA_DIR` (default `./data`, seeded on first run,
git-ignored). See [ADR 0003](../decisions/0003-cloudflare.md) for the
Cloudflare mapping and [the deploy runbook](../deploy/cloudflare.md).

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

## Trust boundaries

- **Public** callers can read everything, register nodes, request upload
  targets and submit signed updates.
- **Internal** callers (other services) can report round progress, submit merge
  candidates and publish versions. On Cloudflare only service bindings reach
  the `InternalApi` entrypoints; on Node an `INTERNAL_API_TOKEN` can be set.
- **Operators** hold `OPERATOR_TOKEN` to start merges and force edge syncs.
- **Reviewers** are identified by Cloudflare Access; the Worker verifies the
  Access JWT on every decision.

## What is deliberately not here yet

- Real training. The seam is `simulateLocalTraining`; the deltas it produces
  are real safetensors, and aggregation over them is real arithmetic.
- Reviewer and node reputation, signed heartbeats, and per-node rate limits.
- Normalised node registry tables for federations past a few thousand nodes
  (ADR 0003).
