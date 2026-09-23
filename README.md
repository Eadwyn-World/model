# Eadwyn AI Model

**An open, federated mind.** A digital mind grown by everyone: weights, code and
training recipes are public; Catalyst Pods, homes and devices train it locally;
only learning travels; every merge is reviewed through governance.

This repository is the platform behind that idea: one monorepo, several
deployable services, one set of typed contracts, and two runtimes. Every
service runs on Node for local development and self-hosting, and on
**Cloudflare Workers** in production (Durable Objects, D1, R2, Queues,
Workflows, a Container, Workers AI, Access). Training stays on the nodes.

- **Philosophy** → [`docs/philosophy.md`](docs/philosophy.md) (drawn from *The World of Eadwyn*)
- **Architecture** → [`docs/architecture/overview.md`](docs/architecture/overview.md)
- **Deploying on Cloudflare** → [`docs/deploy/cloudflare.md`](docs/deploy/cloudflare.md)
- **Node roles** → [`docs/architecture/node-roles.md`](docs/architecture/node-roles.md)
- **Decisions** → [`docs/decisions/`](docs/decisions/)

## Quick start

Requirements: Node 22.12+ and pnpm 10 (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm dev            # Node: coordinator, aggregator, governance, inference edge, merge runner, web
```

Open <http://localhost:3000>. The federation panel reads live data from the
coordinator; if the coordinator is down the page renders a built-in snapshot and
says so. Then run one federated round:

```bash
pnpm demo:round
```

Three mock nodes register, train locally, upload real adapter deltas and submit
signed updates; an operator starts the merge and the pipeline aggregates the
deltas (FedAvg over safetensors); two reviewers approve; the coordinator
publishes the next version and opens the next round; the inference edge syncs
to it. Reload the page and the readout has changed.

### The same stack on Cloudflare, locally

```bash
pnpm dev:cf         # every Worker under local workerd, same ports; web via OpenNext
pnpm demo:round     # same script, same flow, now through Durable Objects, D1, R2, Queues and a Workflow
```

No Cloudflare account is needed locally: wrangler simulates every resource.
Deploying for real is in [the runbook](docs/deploy/cloudflare.md):
`pnpm cf:provision`, set secrets, configure Access, `pnpm cf:deploy`.

No `.env` is needed. Every variable has a schema and a working default; see
[`.env.example`](.env.example) and each app's `.env.example` and
`.dev.vars.example`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | every app on Node, in watch mode (Turborepo) |
| `pnpm dev:services` / `pnpm dev:web` | the backend services only / the web app only |
| `pnpm dev:cf` | every Worker under local workerd (`wrangler dev`) plus the OpenNext web preview |
| `pnpm demo:round` | one federated round, end to end, against whichever stack is running |
| `pnpm check` | lint + type-check + tests |
| `pnpm test` | Vitest: Node suites, then the same contracts inside workerd |
| `pnpm test:workers` | only the workerd suites |
| `pnpm typecheck` | `tsc` for every Node program and every Worker program |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome |
| `pnpm build` | bundles each service to `dist/` (tsup) and builds the web app (Next) |
| `pnpm cf:check` | generated Worker types are current; every Worker bundles (`wrangler deploy --dry-run`) |
| `pnpm cf:types` | regenerate Worker `Env` types from each `wrangler.jsonc` |
| `pnpm cf:provision` | create D1, KV, R2 and Queues on your account and write their ids into the configs |
| `pnpm cf:deploy` | migrate and deploy every Worker, in dependency order |

## Services

| Service | Port | Node | Cloudflare |
| --- | --- | --- | --- |
| `apps/web` | 3000 | Next.js | OpenNext Worker, KV ISR cache, service bindings |
| `apps/coordinator` | 4101 | JSON files | `Federation` Durable Object (nodes, rounds), D1 (versions) |
| `apps/aggregator` | 4102 | JSON file, filesystem objects | D1, R2 (presigned uploads), Queue, Workflow, Container |
| `apps/governance` | 4103 | JSON file | Durable Object per merge, D1 projection, Access |
| `apps/inference-edge` | 4104 | JSON file, mock or Pod proxy | Workers AI (+ LoRA) or Pod proxy, KV cache, D1, cron |
| `apps/merge-runner` | 4105 | aggregation jobs over the filesystem | Container image, R2 via the S3 API |

A few endpoints to poke at once a stack is up:

```bash
curl localhost:4101/v1/stats                 # the federation readout
curl localhost:4103/v1/merges?status=all     # merges and their review state
curl localhost:4103/v1/decisions             # the decision log
curl -X POST localhost:4104/v1/infer -H 'content-type: application/json' \
     -d '{"prompt":"How does the mind rebalance?"}'
```

## Repository layout

```
├─ .github/
│  └─ workflows/
│     ├─ ci.yml
│     └─ deploy-cloudflare.yml
├─ apps/  # deployables (Node entry + Cloudflare Worker entry each)
│  ├─ aggregator/  # uploads, signed updates, merges · D1, R2, Queue, Workflow, Container
│  ├─ coordinator/  # registry, rounds, model version · Federation Durable Object + D1
│  ├─ governance/  # review queue, decisions, quorum · Durable Object per merge + D1, Access
│  ├─ inference-edge/  # served model, inference · Workers AI / Pod proxy, KV, D1, cron
│  ├─ merge-runner/  # large aggregation jobs · Cloudflare Container or Pod GPU
│  └─ web/  # Next.js · the AI Model page · OpenNext Worker
├─ docs/  # architecture, deploy runbook, philosophy, decisions
│  ├─ architecture/
│  │  ├─ node-roles.md
│  │  └─ overview.md
│  ├─ decisions/
│  │  ├─ 0001-monorepo.md
│  │  ├─ 0002-source-exported-packages.md
│  │  └─ 0003-cloudflare.md
│  ├─ deploy/
│  │  └─ cloudflare.md
│  └─ philosophy.md
├─ packages/  # libraries (export TypeScript source)
│  ├─ federation-sdk/  # typed client over HTTP or service bindings
│  ├─ knowledge-index/  # knowledge items with provenance + seed
│  ├─ model-registry/  # current version, idempotent publish, adopt, history
│  ├─ service-kit/  # stores (file, Durable Object, D1), object storage (R2, S3), auth, Hono factory
│  ├─ shared-protocol/  # zod contracts; WebCrypto signing; object keys; fixtures
│  ├─ training-runtime/  # mock local node: register → prepare (upload) → submit
│  ├─ ui/  # tokens, base styles, lattice/root motifs, primitives
│  └─ weights/  # safetensors codec, FedAvg / median / trimmed mean, aggregation job
├─ scripts/  # demo round, Cloudflare provisioning, dev vars
│  ├─ cf-provision.ts
│  ├─ demo-round.ts
│  └─ ensure-dev-vars.mjs
├─ .dockerignore
├─ .editorconfig
├─ .env.example
├─ .gitignore
├─ .npmrc
├─ README.md
├─ biome.json
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ tsconfig.json
└─ turbo.json
```

`apps/*` are deployables; `packages/*` are libraries. Each app has a Node
entrypoint (`src/index.ts`) and a Worker entrypoint (`src/worker/index.ts`)
that build the same routes; only the storage adapters differ. Packages export
TypeScript source and never depend on apps. See ADRs
[0001](docs/decisions/0001-monorepo.md),
[0002](docs/decisions/0002-source-exported-packages.md) and
[0003](docs/decisions/0003-cloudflare.md).

## How a round works

1. A node registers with the coordinator, sending its Ed25519 public key;
   registration is idempotent on the key.
2. It trains locally and gets an adapter delta (safetensors). It asks the
   aggregator for an upload target, uploads the delta (straight to R2 with a
   presigned URL, or through the aggregator with a signed URL), then submits a
   `TrainingUpdate` that references the delta by key and sha256, signed over
   its canonical JSON. Data never leaves the node.
3. The aggregator checks the update's size, where its delta lives, replay, one
   update per node per round, the signature against the coordinator's
   registry, and that the stored bytes match the signed digest. It records the
   update and reports progress to the coordinator (a Queue on Cloudflare).
4. An operator starts the merge. The aggregator writes a manifest (which deltas,
   with which weights) and a pending candidate; its pipeline (a Workflow on
   Cloudflare) re-verifies every delta, aggregates them, records the merged
   checkpoint and forwards the candidate to governance.
5. Reviewers record decisions with rationales, identified by Cloudflare Access
   in production. At quorum the candidate is approved and governance asks the
   coordinator to publish; if the coordinator is unreachable it retries.
6. The coordinator publishes the next version (idempotently per candidate),
   closes the round and opens the next one. The inference edge adopts the new
   version on its next sync, and the page's readout changes.

Every request and response crosses the boundary through schemas in
`@eadwyn/shared-protocol`; services validate inbound bodies and the SDK
validates responses. Routes that change what the federation believes are
internal-only: on Cloudflare only service bindings reach them.

## Environment variables

Every variable has a default; production values live in each `wrangler.jsonc`
(`vars`) and in Worker secrets.

| Variable | Default | Used by |
| --- | --- | --- |
| `PORT`, `HOST`, `DATA_DIR`, `LOG_FORMAT`, `LOG_LEVEL` | per app, `./data`, `pretty`, `info` | Node services |
| `COORDINATOR_URL`, `AGGREGATOR_URL`, `GOVERNANCE_URL`, `INFERENCE_EDGE_URL` | `http://localhost:41xx` | Node services, web, SDK, demo |
| `SEED_MODE` | `fixtures` on Node, `genesis` on Cloudflare | coordinator, governance, aggregator, edge |
| `INTERNAL_API_TOKEN` | unset (local: everyone is internal) | Node services |
| `OPERATOR_TOKEN` | unset | aggregator (start merges), edge (force sync) |
| `COORDINATOR_EXPECTED_NODES`, `COORDINATOR_ONLINE_WINDOW_MINUTES` | `128`, `360` | coordinator |
| `AGGREGATOR_VERIFY_SIGNATURES`, `AGGREGATOR_MAX_DELTA_BYTES` | `true`, `64 MiB` | aggregator |
| `UPLOAD_TOKEN_SECRET`, `UPLOAD_TTL_SECONDS` | per process on Node, `900` | aggregator (direct uploads) |
| `AGGREGATION_BACKEND`, `INLINE_AGGREGATION_MAX_BYTES` | `auto`, `32 MiB` | aggregator |
| `MERGE_RUNNER_URL`, `MERGE_RUNNER_TOKEN` | unset | aggregator, merge runner |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_*_BUCKET` | unset, `eadwyn-deltas` / `eadwyn-checkpoints` | aggregator (presigned uploads, Container) |
| `GOVERNANCE_APPROVAL_QUORUM`, `GOVERNANCE_REJECTION_QUORUM` | `2`, `1` | governance |
| `REVIEWER_AUTH`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | `none` on Node, `access` on Cloudflare | governance |
| `INFERENCE_BACKEND`, `WORKERS_AI_MODEL`, `WORKERS_AI_LORA` | `auto`, a LoRA-capable Mistral 7B | inference edge |
| `UPSTREAM_INFERENCE_URL`, `UPSTREAM_ACCESS_CLIENT_ID`, `UPSTREAM_ACCESS_CLIENT_SECRET` | unset | inference edge (Pod proxy) |
| `EADWYN_DATA_SOURCE`, `NEXT_PUBLIC_SOURCE_URL` | `auto`, this repository | web |

## Testing

Each service has a contract suite (`src/__tests__/contract.ts`) that runs twice:
against the Node app, and inside workerd against the real Worker entrypoints
(`test/workers`), with real Durable Objects, D1 (with migrations), R2, KV,
Queues and Workflows. Stand-ins replace only the neighbouring services behind
service bindings. Packages have their own unit tests; `service-kit` also tests
its Durable Object and D1 stores inside workerd. CI runs lint, both type-check
programs, both test runs, the builds, and a deploy dry run of every Worker.

## What is simulated, and where the seams are

| Simulated today | Seam |
| --- | --- |
| local training | `simulateLocalTraining` in `packages/training-runtime`; its deltas are real safetensors, and everything after it is real |
| local-development inference | the edge's labelled mock backend; production uses Workers AI with an Eadwyn LoRA adapter or a Pod GPU |
| the Container locally | needs a Docker daemon; local merges run inline |

## Open questions for maintainers

- **License.** The code is meant to be open source, but no `LICENSE` file has
  been added yet; choosing one (Apache-2.0 is the model versions' declared
  license) is a maintainer decision.
- **Node admission.** Registration is open; signed heartbeats and per-node rate
  limits are the next steps before a public launch.
