# Node roles

"Every Catalyst Pod can run a node" is the first sentence of the design. This
page says what a node is, which kinds exist, and what each is trusted to do.

## What a node is

A node is anything that holds local knowledge and can run a training step. It
has:

- an identity: a `nodeId` assigned by the coordinator and an Ed25519 key pair
  the node generates itself (the private key never leaves the node);
- a role and capabilities (`compute`, memory, the largest update it will send);
- optionally a Pod it belongs to and a region.

The contract is `NodeIdentity` in `@eadwyn/shared-protocol`.

## Training roles

| Role | Where it runs | Typical compute | What it contributes |
| --- | --- | --- | --- |
| `pod` | a Catalyst Pod: a community hub with its own data-science infrastructure | GPUs, always on | the largest updates; field data from the Pod's sensors and people |
| `home` | a home server, a workstation, a laptop overnight | CPU or a consumer GPU | steady small updates; household and neighbourhood knowledge |
| `device` | a field device: soil probe, canal sensor, microgrid meter, rooftop farm controller | edge | tiny updates from a single stream of observations |
| `lab` | a research cluster | many GPUs | large updates and evaluation runs |

All four go through the same three calls (`registerNode`, `prepareLocalUpdate`,
`submitUpdate`) and are validated the same way. Aggregation weights an update by
the learning it carries, not by its role.

## Serving and governing roles

| Role | What it does | Trust |
| --- | --- | --- |
| coordinator | keeps the registry, opens and closes rounds, publishes approved versions | trusted to schedule, never to decide |
| aggregator | verifies and stores updates, proposes merge candidates | trusted to propose, never to publish |
| governance | records decisions, applies quorum, asks for publication | trusted to record; people decide |
| reviewer | a person who reads a candidate and records a decision with a rationale | the only role that changes the mind |
| inference edge | serves a published version to the public | read-only |

## Lifecycle of a training node

1. **Register.** `POST /v1/nodes/register` with the public key. Registration is
   idempotent on the key, so a restarted node keeps its identity.
2. **Heartbeat.** `POST /v1/nodes/:id/heartbeat` keeps the node "online" in the
   readout and returns the active round.
3. **Learn locally.** Train on local knowledge for the round's base version.
4. **Submit.** Sign the update and `POST /v1/updates` to the aggregator. One
   update per node per round; replays are refused.
5. **Re-synchronise.** When a merge is published a new round opens on the new
   version; the node pulls it and starts again.

## Running a node today

```bash
pnpm dev:services          # coordinator, aggregator, governance, inference edge
pnpm demo:round            # three mock nodes run one full round
```

The mock node lives in `packages/training-runtime`. Replacing
`simulateLocalTraining` with a real trainer is the seam for the first real node.
