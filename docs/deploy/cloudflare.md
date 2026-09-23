# Deploying Eadwyn on Cloudflare

Every service in this repository runs on Cloudflare Workers: the coordinator,
governance, aggregator and inference edge as Workers with Durable Objects, D1,
R2, Queues, Workflows and a Container; the AI Model page as a Worker built
with OpenNext. Training never runs on Cloudflare: it stays on the nodes, and
only signed updates, their deltas, metadata and decisions travel.

This runbook covers local development, the one-time account setup, and
deploying. The architecture and the reasons behind it are in
[ADR 0003](../decisions/0003-cloudflare.md).

## What runs where

```
Training (Pods / homes / devices)
         │ signed updates + deltas only
         ▼
eadwyn-coordinator ── Durable Object "Federation" (node registry, rounds)
         │            D1 (model version history)
         │ service bindings (InternalApi entrypoints)
         ▼
eadwyn-aggregator ─── Worker: upload targets, update validation
         │            R2 (deltas, manifests, merged checkpoints; presigned uploads)
         │            Queue → coordinator round progress
         │            Workflow: aggregate → record checkpoint → forward
         │            Container (merge-runner) or Pod GPU for large merges
         │            D1 (updates, candidates; uniqueness constraints)
         ▼
eadwyn-governance ─── Durable Object per merge (votes, publish decision, retries)
         │            D1 projection (listings, decision log)
         │            Cloudflare Access (reviewer identity)
         ▼
eadwyn-inference-edge ─ Workers AI + Eadwyn LoRA adapter, or proxy to a Pod GPU
                        KV (response cache), D1 (served registry), Cron sync

eadwyn-web ─────────── Worker via OpenNext: Workers Assets, KV (ISR cache),
                        service bindings to the coordinator and governance
```

| Worker | Config | Needs |
| --- | --- | --- |
| `eadwyn-coordinator` | `apps/coordinator/wrangler.jsonc` | D1 `eadwyn-coordinator` |
| `eadwyn-governance` | `apps/governance/wrangler.jsonc` | D1 `eadwyn-governance`, an Access application |
| `eadwyn-aggregator` | `apps/aggregator/wrangler.jsonc` | D1 `eadwyn-aggregator`, R2 `eadwyn-deltas` and `eadwyn-checkpoints`, Queues `eadwyn-federation-events` (+ `-dlq`), a Workflow, a Container |
| `eadwyn-inference-edge` | `apps/inference-edge/wrangler.jsonc` | D1 `eadwyn-edge`, KV, Workers AI |
| `eadwyn-web` | `apps/web/wrangler.jsonc` | KV (ISR cache) |

Internal routes are only reachable through service bindings. Each backend
Worker exports a named `InternalApi` entrypoint; bindings target it, and
nothing on the public internet can. Publishing a version, reporting round
progress and submitting merge candidates all require it.

## Local development (no account needed)

```bash
pnpm install
pnpm dev:cf          # all four Workers + the OpenNext web preview under local workerd
pnpm demo:round      # one federated round against them
```

`pnpm dev:cf` applies D1 migrations locally, copies each app's
`.dev.vars.example` to `.dev.vars`, and runs `wrangler dev` on the same ports as
the Node stack (4101–4104, web on 3000). Wrangler simulates D1, R2, KV, Queues,
Workflows, Durable Objects and service bindings. Locally:

- reviewers name themselves (`REVIEWER_AUTH=none`); Access does not exist locally;
- the inference edge answers with the labelled mock (Workers AI needs an account);
- merges run inline in the Workflow step; the Container needs a Docker daemon
  (`"dev": { "enable_containers": true }` in the aggregator config to try it);
- wrangler 4.137's local Workflows engine logs "Worker's code had hung" when an
  instance completes. The instance still completes; a one-step Workflow shows
  the same line. It does not happen on Cloudflare.

Tests that run inside workerd:

```bash
pnpm test:workers    # contract suites against the real Worker entrypoints
pnpm cf:check        # generated types are current + every Worker bundles (deploy --dry-run)
```

## One-time setup

You need a Cloudflare account on the **Workers Paid** plan (Containers require
it) and wrangler authenticated: `pnpm exec wrangler login`, or
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.

### 1. Create the resources

```bash
pnpm cf:provision --dry-run   # see what it will do
pnpm cf:provision
```

This creates the four D1 databases, two KV namespaces, two R2 buckets and two
Queues, and writes the new ids into the `wrangler.jsonc` files. Commit those
changes. It is safe to re-run.

### 2. Set secrets

```bash
cd apps/aggregator
pnpm exec wrangler secret put UPLOAD_TOKEN_SECRET   # 32+ random bytes; signs direct upload URLs
pnpm exec wrangler secret put OPERATOR_TOKEN        # lets operators start merges
cd ../inference-edge
pnpm exec wrangler secret put OPERATOR_TOKEN        # lets operators force a sync
```

Optional, for presigned direct-to-R2 uploads and the Container: create an R2
API token (R2 → Manage API tokens, object read and write on both buckets) and
set on the aggregator:

```bash
pnpm exec wrangler secret put R2_ACCOUNT_ID
pnpm exec wrangler secret put R2_ACCESS_KEY_ID
pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY
pnpm exec wrangler secret put MERGE_RUNNER_TOKEN    # optional: the Container checks it on every job
```

With these set, nodes upload deltas straight to R2 with presigned URLs bound to
one key and to the delta's sha256; without them, uploads go through the
aggregator Worker (fine up to the Worker request limit, 100 MB on most plans).

### 3. Put reviewers behind Cloudflare Access

Review decisions are refused until Access is configured (`REVIEWER_AUTH=access`
fails closed).

1. Zero Trust → Access → Applications → add a **self-hosted** application for
   the hostname reviewers will use, for example `review.eadwyn.world`, routed to
   `eadwyn-governance`. Keep the public API hostname unprotected so merges and
   the decision log stay publicly readable.
2. Add a policy that allows your reviewers (emails, a group, or an IdP rule).
3. Copy the application's **AUD tag**, and set in `apps/governance/wrangler.jsonc`:

   ```jsonc
   "ACCESS_TEAM_DOMAIN": "<your-team>.cloudflareaccess.com",
   "ACCESS_AUD": "<aud tag>"
   ```

The Worker verifies the `Cf-Access-Jwt-Assertion` JWT on every decision
(signature against the team's keys, audience, issuer, expiry) and records the
verified email as the reviewer. A request that did not come through Access has
no valid token and is refused, whatever hostname it used.

### 4. Choose how the edge answers

- **Workers AI** (default when bound): a LoRA-capable base model plus the
  Eadwyn adapter. Adapters must be at most 300 MB, rank 32 or less, trained on
  a supported non-quantized base, and packaged as `adapter_config.json` +
  `adapter_model.safetensors`:

  ```bash
  pnpm exec wrangler ai finetune create @cf/mistral/mistral-7b-instruct-v0.2-lora eadwyn-0-2-0 ./adapter/
  ```

  Then set `WORKERS_AI_LORA` (and `WORKERS_AI_MODEL` if you used another base)
  in `apps/inference-edge/wrangler.jsonc`. Until an adapter is set, answers
  come from the base model alone, and say so: the response names the runtime
  `model` and leaves `adapter` empty. Text generation on Workers AI is
  rate limited per account (720 requests per minute at the time of writing);
  the KV cache absorbs repeated prompts.
- **A Pod GPU**: when the Eadwyn model does not fit those constraints, serve it
  from a Pod (for example `apps/inference-edge` itself on the Pod, behind
  Cloudflare Tunnel) and set `UPSTREAM_INFERENCE_URL`. Protect the Pod with
  Access and give the edge a service token:
  `wrangler secret put UPSTREAM_ACCESS_CLIENT_ID` and
  `UPSTREAM_ACCESS_CLIENT_SECRET`.

### 5. Choose where large merges run

`AGGREGATION_BACKEND=auto` merges small adapters inside the Workflow step (up to
`INLINE_AGGREGATION_MAX_BYTES`, 32 MB by default: a Worker has 128 MB of
memory). Larger merges go to `MERGE_RUNNER_URL` (a merge runner on a Pod GPU)
if set, otherwise to the `MergeRunnerContainer` Container, which runs
`apps/merge-runner` against R2's S3 API (it needs the R2 secrets above). The
Container image is built from `apps/merge-runner/Dockerfile` during deploy, so
the deploying machine needs Docker.

## Deploy

Deploy order follows the service bindings: a Worker's bound services should
exist first.

```bash
pnpm cf:deploy
```

runs, in order, for coordinator → governance → aggregator → inference edge
(each: `wrangler d1 migrations apply DB --remote && wrangler deploy`) and then
the web app (`opennextjs-cloudflare build && opennextjs-cloudflare deploy`).
The GitHub Actions workflow `Deploy to Cloudflare` runs the same steps on
demand; it needs the repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

After the first deploy:

```bash
curl https://eadwyn-coordinator.<subdomain>.workers.dev/v1/stats   # genesis: v0.1.0, round 1
curl https://eadwyn-inference-edge.<subdomain>.workers.dev/health
```

Add custom domains in the dashboard or with `routes` in each config. A real
deployment starts at the genesis version with no nodes (`SEED_MODE=genesis`):
nothing fake is ever recorded.

## Operating

| Task | How |
| --- | --- |
| Start a merge for a round | `POST /v1/merges` on the aggregator with `Authorization: Bearer $OPERATOR_TOKEN` |
| Watch a merge | `GET /v1/merges/:id` on the aggregator (pipeline steps), or the Workflows dashboard |
| Review | reviewers sign in through Access and `POST /v1/merges/:id/decisions` |
| Force the edge to serve the latest version | `POST /v1/sync` on the edge with the operator token (a cron does it every five minutes) |
| Undeliverable progress reports | the `eadwyn-federation-events-dlq` queue |
| Logs and traces | Workers Observability is enabled in every config |

## Limits to design around

- **Workers are not GPUs.** Training never runs here, and weight aggregation
  only runs inside a Worker for small adapters; everything larger goes to the
  Container or a Pod.
- **Workers AI hosts fixed base models.** Your own weights must be a LoRA
  adapter on a supported base; otherwise serve from a Pod and let the edge
  proxy and cache.
- **Request bodies are capped** (100 MB on most plans), so large deltas must use
  presigned uploads straight to R2.
- **One Durable Object per coordinator.** The node registry and rounds are one
  document in one object, which serialises registration, progress and round
  rollover. That is simple and consistent to thousands of nodes; past that,
  move the node registry into the object's SQLite tables (ADR 0003).
