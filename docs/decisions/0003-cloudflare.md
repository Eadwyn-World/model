# ADR 0003: Run the platform on Cloudflare Workers

**Status:** accepted · **Date:** 2026-09-23

## Context

The platform should be deployable without anyone owning servers: a federation
with "no single center" should not depend on one operator's machines. Cloudflare
Workers offer that, with durable primitives (Durable Objects, D1, R2, KV,
Queues, Workflows), identity (Access), GPUs for inference (Workers AI) and
Containers for work that does not fit a Worker. They do not offer arbitrary
GPU training, and a Worker has 128 MB of memory and bounded CPU time.

## Decision

Keep every service's routes and domain logic runtime-agnostic, and give each
service a second entrypoint for Workers. The Node entrypoints stay for local
development and self-hosting (a Pod can run any service).

What changed to make that possible:

1. **Stores.** The three-method document store (`read`, `update`, `reset`)
   gained a Durable Object backend (chunked, atomic `put`) and a D1 backend
   (optimistic concurrency: every write is one batch that only applies if the
   revision it read is still current). The interface did not change.
2. **Crypto.** Signing and hashing moved from `node:crypto` to WebCrypto,
   which Node, Workers and browsers share.
3. **Deltas.** Updates reference deltas in object storage by a key derived from
   their round and update id. Nodes upload before submitting, straight to R2
   with presigned URLs (SigV4, bound to one key and to the sha256) or through
   the aggregator (HMAC-signed URLs). Every stored object is verified against
   the signed digest, and the aggregation job verifies it again.
4. **Entrypoints.** Each Worker builds the same Hono app from its `Env`
   bindings. A named `InternalApi` entrypoint, reachable only through service
   bindings, marks callers as internal; the public entrypoint cannot.

Service by service:

- **Coordinator: one `Federation` Durable Object** holds the node registry and
  the rounds; the model version history is in D1. The plan we started from
  suggested a Durable Object per round. Rounds are strictly sequential with one
  active at a time, and publishing must close one round and open the next
  atomically; one object makes that a single write, where per-round objects
  would need a directory object and cross-object repair. Progress reports go to
  that one object either way. Sharding is the step to take if one object's
  write rate ever becomes the limit.
- **Governance: one `MergeReview` Durable Object per candidate.** Merges are
  independent and reviewed in parallel, so each gets its own serialisation of
  votes and its own publish decision, with alarm-driven retries when the
  coordinator is unreachable (publishing is idempotent per candidate). Listings
  read a D1 projection the objects keep current.
- **Aggregator: D1 tables** whose uniqueness constraints make "accepted once"
  and "one update per node per round" race-free; **R2** for bytes; a **Queue**
  for round progress (at-least-once, so the coordinator counts each node once);
  a **Workflow** for the merge pipeline (aggregate → record checkpoint →
  forward to governance), each step persisted and retried alone. The weight
  math runs inline for small adapters and in a **Container** or on a Pod GPU
  otherwise; all three run the same job code.
- **Inference edge:** Workers AI with an Eadwyn LoRA adapter, or a proxy to a
  Pod GPU; KV response cache; D1 served registry kept current by a Cron Trigger.
- **Web:** OpenNext on Workers, ISR cache in KV, reading the coordinator and
  governance through service bindings with the same federation SDK (its
  per-service transports accept a binding's `fetch`).
- **Reviewer identity:** Cloudflare Access, verified in the Worker.

## Consequences

- Every contract test suite runs twice: on Node and inside workerd against the
  real Worker entrypoints, so the two runtimes cannot drift silently.
- Deployments start at the genesis version (`SEED_MODE=genesis`); fixture data
  exists only in local Node development.
- Operating the platform needs a Cloudflare account on a paid plan (Containers)
  and Docker wherever the aggregator is deployed from.
- The merge pipeline is asynchronous: `POST /v1/merges` returns a pending
  candidate and a pipeline id; governance receives the candidate once its
  merged checkpoint exists.
