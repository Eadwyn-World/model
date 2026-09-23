/**
 * Seed knowledge items.
 *
 * These are examples drawn from "The World of Eadwyn" (Guillaume Lauzier) so
 * the index has the texture of the world it serves: Catalyst Pods, living
 * architecture, the Exchange Ledger, the solar lull, Resilience Nodes.
 * Replace or extend freely; the shape is what matters.
 */
import type { KnowledgeItem } from "./types";

const WORLD_DOC = "the-world-of-eadwyn";

export function seedKnowledgeItems(): KnowledgeItem[] {
  return [
    {
      id: "ki-0001",
      title: "Catalyst Pods: autonomous hubs that link into a network",
      type: "lore",
      source: { kind: "document", ref: `${WORLD_DOC}#catalyst-pods` },
      summary:
        "Catalyst Pods are modular hubs with their own data-science infrastructure. Each Pod functions autonomously but can be linked with others into a networked ecosystem; data collected by one Pod is shared across the network so cities can make holistic decisions. This is the template for every Pod node in the federation.",
      tags: ["pods", "network", "governance", "architecture"],
      contributor: { id: "c-lauzier", displayName: "Guillaume Lauzier" },
      status: "merged",
      createdAt: "2026-06-02T09:15:00Z",
    },
    {
      id: "ki-0002",
      title: "The Exchange Ledger records every contribution transparently",
      type: "lore",
      source: { kind: "document", ref: `${WORLD_DOC}#economic-models` },
      summary:
        "Neighbours trade infrastructure services through a decentralised ledger that records goods, energy credits, labour and shared knowledge. The record is transparent and immutable, and contributions are valued by their impact on the community rather than by price. The federation's decision log and version history follow the same idea.",
      tags: ["ledger", "trust", "economy", "provenance"],
      contributor: { id: "c-lauzier", displayName: "Guillaume Lauzier" },
      status: "merged",
      createdAt: "2026-06-02T09:40:00Z",
    },
    {
      id: "ki-0003",
      title: "Living walls: algae glow at night, vines shade by day",
      type: "lore",
      source: { kind: "document", ref: `${WORLD_DOC}#introduction` },
      summary:
        "Building walls are lined with photosensitive algae that store solar energy by day and glow softly at night, while moss, ivy and vines on the facades provide shade, oxygen and filtering. The structures shift slightly with the seasons as the living materials adapt.",
      tags: ["architecture", "bioluminescence", "energy"],
      contributor: { id: "c-lauzier", displayName: "Guillaume Lauzier" },
      status: "merged",
      createdAt: "2026-06-03T14:05:00Z",
    },
    {
      id: "ki-0004",
      title: "Solar lull: microgrid output down for nine days on the eastern terraces",
      type: "field-note",
      source: { kind: "pod", ref: "pod-riverside" },
      summary:
        "Wind fell to a fraction of its seasonal average while solar generation dipped at the same time. The predictive models had assumed the two sources would not fail together. Storage carried essential loads for four days; after that, hospitals and water purification were prioritised by hand. Recommendation: diversify sources per node and rehearse manual fallback.",
      tags: ["energy", "resilience", "microgrid", "field-data"],
      contributor: { id: "c-ines", displayName: "Inès (energy steward)", podId: "pod-riverside" },
      status: "accepted",
      createdAt: "2026-08-19T18:30:00Z",
    },
    {
      id: "ki-0005",
      title: "Aquaponic pH drift after pump brownouts",
      type: "field-note",
      source: { kind: "node", ref: "a1b2c3d4-0001-4000-8000-000000000007" },
      summary:
        "When the grid browned out, filtration pumps ran at partial capacity and pH drifted 0.6 in under a day. Fish stress rose before the crop showed damage. A single sensor threshold missed the onset; a rate-of-change alert would have caught it eight hours earlier.",
      tags: ["aquaponics", "water", "sensors", "food"],
      contributor: {
        id: "c-tomas",
        displayName: "Tomas (rooftop farm)",
        podId: "pod-north-terraces",
      },
      status: "accepted",
      createdAt: "2026-08-21T07:50:00Z",
    },
    {
      id: "ki-0006",
      title: "Bioluminescent plantings cool the canal walk on warm evenings",
      type: "observation",
      source: { kind: "contributor", ref: "c-mara" },
      summary:
        "Measured a 1.8 °C drop along the canal walk after dusk on three warm evenings, consistent with the plants releasing cooling agents as the temperature rises. The glow stayed within the pale blue–green band the whole time.",
      tags: ["climate", "bioluminescence", "public-space"],
      contributor: { id: "c-mara", displayName: "Mara (night surveys)" },
      status: "accepted",
      createdAt: "2026-08-28T22:10:00Z",
    },
    {
      id: "ki-0007",
      title: "Adaptive road surfaces soften after sunset; foot traffic rises",
      type: "observation",
      source: { kind: "pod", ref: "pod-riverside" },
      summary:
        "Pedestrian counts on the market street rise about a fifth once the walkway softens in the evening. Worth feeding into the transport model: the surface schedule is a mobility lever, not only a comfort setting.",
      tags: ["mobility", "materials", "urban"],
      contributor: { id: "c-ines", displayName: "Inès (energy steward)", podId: "pod-riverside" },
      status: "proposed",
      createdAt: "2026-09-04T19:25:00Z",
    },
    {
      id: "ki-0008",
      title: "Correction: in-stream turbines, not small dams",
      type: "correction",
      source: { kind: "document", ref: `${WORLD_DOC}#localized-economy` },
      summary:
        "An earlier summary described hydro generation as 'small dams'. The source is explicit that there are no dams: small turbines are embedded within the watercourses and designed to mimic natural ecosystems with minimal disruption to flow.",
      tags: ["energy", "hydro", "correction"],
      contributor: {
        id: "c-tomas",
        displayName: "Tomas (rooftop farm)",
        podId: "pod-north-terraces",
      },
      supersedes: "ki-0003",
      status: "accepted",
      createdAt: "2026-09-08T10:00:00Z",
    },
    {
      id: "ki-0009",
      title: "Correction: tokens measure contribution, not accumulated wealth",
      type: "correction",
      source: { kind: "document", ref: `${WORLD_DOC}#economic-models` },
      summary:
        "Tokens in the Exchange are earned for contributions and represent a person's involvement in the collective, and the currency of the society is time and effort. A previous item treated tokens as savings that could be hoarded; equity buffers exist precisely to prevent that.",
      tags: ["economy", "tokens", "correction", "equity"],
      contributor: { id: "c-lauzier", displayName: "Guillaume Lauzier" },
      supersedes: "ki-0002",
      status: "accepted",
      createdAt: "2026-09-10T16:45:00Z",
    },
    {
      id: "ki-0010",
      title: "Resilience Nodes: independent when they must be, connected when they can be",
      type: "lore",
      source: { kind: "document", ref: `${WORLD_DOC}#reimagining-the-system` },
      summary:
        "After the crisis, infrastructure was rebuilt as Resilience Nodes: small self-sustaining units for energy, water, food or governance that operate independently but share resources with neighbours through the network. If one node fails the others step in. The federation borrows the name and the principle: no single point of failure.",
      tags: ["resilience", "nodes", "architecture", "governance"],
      contributor: { id: "c-lauzier", displayName: "Guillaume Lauzier" },
      status: "merged",
      createdAt: "2026-09-12T11:20:00Z",
    },
    {
      id: "ki-0011",
      title: "Community resilience hub inventory, week three after the storm",
      type: "field-note",
      source: { kind: "pod", ref: "pod-north-terraces" },
      summary:
        "Hub stocked 340 kWh of shared storage, two hand-operated filtration rigs and a rota of 41 volunteers. Most requests were for knowledge, not goods: how to run a pump by hand, how to read the soil sensors without the dashboard. Skills should be indexed alongside supplies.",
      tags: ["mutual-aid", "resilience", "skills", "field-data"],
      contributor: {
        id: "c-tomas",
        displayName: "Tomas (rooftop farm)",
        podId: "pod-north-terraces",
      },
      status: "accepted",
      createdAt: "2026-09-15T08:05:00Z",
    },
  ];
}
