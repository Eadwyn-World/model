# The philosophy of the Eadwyn model

The Eadwyn AI Model is the digital counterpart of the world described in
*The World of Eadwyn* (Guillaume Lauzier). That text is the source for how the
platform is shaped. This page distils it into commitments the code has to keep,
and says where each one lives in the repository.

> Technology is a tool for empowerment, not control.
> — *The World of Eadwyn*, "Reimagining the System"

## 1. No single center

*The world:* "The concentration of power, whether it's economic, political, or
technological, undermines the health and fairness of society." Catalyst Pods
function autonomously but link into a networked ecosystem; after the crisis,
infrastructure is rebuilt as Resilience Nodes that "operate independently but
are interconnected with the larger network."

*The model:* the federation has roles, not an owner. The coordinator schedules
rounds and keeps the registry; it never holds training data and never decides
what gets merged. Any Pod, home or device can run a node. Any service can be
replaced or run by another community.

*In the code:* `apps/coordinator` (scheduler and registry only),
`packages/training-runtime` (any node can join), `docs/architecture/node-roles.md`.

## 2. Data stays where it grows

*The world:* "Everything from food to energy is produced within a few miles of
where it is consumed." Local production, local control, local decisions.

*The model:* nodes train on the knowledge they hold, in the place that holds it.
The only thing that leaves a node is a signed, content-addressed update: what
changed, never what it was trained on. The protocol carries references to
artifacts, not the artifacts themselves.

*In the code:* `TrainingUpdate` and `ArtifactRef` in `packages/shared-protocol`;
the aggregator stores update references and metrics, not data.

## 3. Knowledge belongs to everyone

*The world:* Eadwyn "sees knowledge as a form of power, one that should be
available to everyone, not just a select few. They champion open-source models,
shared information, and community-driven learning."

*The model:* weights, code and training recipes are public. Contributed knowledge
(field notes, lore, corrections, observations) is indexed with its provenance and
credited to the contributor. Every merge lists the knowledge it learned from.

*In the code:* `packages/knowledge-index`, the `knowledgeItemIds` field on every
update, and the public federation readout on the AI Model page.

## 4. Technology serves human judgment

*The world:* after the smart systems buckled, the community chose "human-centered
technology ... systems that empower individuals and communities to make decisions
locally, using technology as a tool to support human judgment, rather than replace
it." Governance "will remain human-driven."

*The model:* nothing enters the shared model without review. The aggregator can
only propose; reviewers decide; decisions are logged with a rationale and never
overwritten. A merge is approved by a quorum of people, not by a metric.

*In the code:* `apps/governance` (pending queue, decision log, quorum),
`GovernanceDecision` in the protocol, and the "Review merges" path on the page.

## 5. Every contribution counts, weighted by its impact

*The world:* in the Equity Exchange "everyone's contributions were valued equally,
regardless of their background", and value is measured by "impact on the
community and the environment, rather than the pure financial value."

*The model:* a laptop overnight and a Pod with GPUs both take part in a round.
Aggregation weights updates by the learning they carry (validated samples and
loss), not by who sent them. Contributions are recorded in the round, the
candidate and the version history.

*In the code:* `buildMergeCandidate` in `apps/aggregator`, `participatingNodeIds`
on `TrainingRound`, contributor fields on knowledge items.

## 6. Transparent by default

*The world:* the Exchange Ledger creates "a transparent, immutable record that
guarantees fairness"; governance runs on votes that are "recorded, and the outcome
is immediately visible to all members."

*The model:* updates are signed and verified against a public node registry.
Candidates are content-addressed. The decision log and the version history are
public APIs. The AI Model page is a live readout of the federation, not a brochure.

*In the code:* Ed25519 signatures in `packages/shared-protocol/src/signing.ts`,
`GET /v1/decisions`, `GET /v1/model/versions`, and `apps/web`'s federation panel.

## 7. Resilience over perfection

*The world:* the crisis teaches that "true sustainability is not about creating a
perfect world; it is about building systems that can withstand the challenges of
an ever-changing environment" and that "failure is not feared, but seen as an
opportunity to learn and improve."

*The model:* every cross-service signal is best-effort; a service being down
degrades its neighbours instead of stopping them. The web page falls back to a
snapshot and says so. Rejected merges stay in the log as learning. Rounds whose
base went stale are closed, not forced through.

*In the code:* `bestEffort` in `packages/service-kit`, the snapshot fallback in
`apps/web/src/lib/federation.ts`, `rollRoundsAfterPublish` in the coordinator.

## 8. Regeneration, not extraction

*The world:* "trade should be regenerative, enriching the world for future
generations rather than depleting it."

*The model:* learning flows back. A published version is available to every node
that helped grow it, and to the Pods that did not. The model should return more
to the communities that train it than it takes from them. This is the standard
future work is measured against.

*In the code:* published versions re-open a round on the new base for every node;
the inference edge serves them publicly.

## Vocabulary

| In *The World of Eadwyn* | In the platform |
| --- | --- |
| Catalyst Pod | a Pod node (`role: "pod"`), usually with GPUs and a community around it |
| Resilience Node | any node: independent when it must be, connected when it can be |
| Exchange Ledger | the decision log and version history |
| Equity Exchange | contribution weighting in aggregation |
| the community summit | governance review |
| "the mind rebalances" | an approved merge is published and every node re-synchronises |

## What we refuse to build

- A central data lake. Data stays on nodes; the protocol has no field for it.
- Unreviewed merges. No configuration flag skips governance.
- A single point of control. No service may be required for the others to run.
- Silent overrides of human decisions. Decisions are append-only.
- Inference that hides its version. Every answer names the published version that gave it.
