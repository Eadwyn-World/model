/**
 * All copy for the AI Model page in one place, so wording can be tuned
 * without touching layout. Wording follows the Eadwyn concept vocabulary.
 */
import { SOURCE_URL } from "@/lib/env";

export const nav = {
  links: [
    { label: "Principles", href: "#principles" },
    { label: "Live", href: "#federation" },
    { label: "How it grows", href: "#how-it-grows" },
    { label: "Contribute", href: "#contribute" },
  ],
  source: { label: "Source on GitHub", href: SOURCE_URL },
};

export const hero = {
  eyebrow: "Eadwyn · AI Model",
  title: "An open, federated mind.",
  lede: "A digital mind grown by everyone. Its weights, code and training recipes are public. It has no single center: Catalyst Pods, homes and devices train it where their knowledge lives, and only what they learn travels.",
  primary: { label: "Run a node", href: "#contribute" },
  secondary: { label: "Source on GitHub", href: SOURCE_URL },
};

export const principles = {
  index: "01 / Principles",
  title: "Three commitments, kept in code.",
  lede: "The platform is built so that breaking any of these would take a visible change to the source, not a quiet change of policy.",
  items: [
    {
      number: "01",
      title: "Open source",
      body: "Weights, code and training recipes are published for anyone to inspect, reproduce or fork. Knowledge is a form of power, and it belongs to everyone.",
    },
    {
      number: "02",
      title: "Federated",
      body: "No single center. Nodes train on the data they hold, in the Pod, home or device where it grows. Data stays. Only learning travels, as a signed update.",
    },
    {
      number: "03",
      title: "Grown by everyone",
      body: "Contributors add knowledge, corrections and compute. Every merge into the shared model is reviewed by people, not blindly accepted.",
    },
  ],
};

export const federation = {
  index: "02 / The federation, live",
  title: "A public readout of the shared mind.",
  lede: "What the coordinator knows right now: the global model, the open training round, the nodes that make it up. Refreshes every fifteen seconds.",
  labels: {
    model: "Global model",
    round: "Active round",
    nodes: "Registered nodes",
    sync: "Last sync",
    merges: "Merges in review",
  },
  sourceLive: "live",
  sourceSnapshot: "snapshot",
};

export const loop = {
  index: "03 / How the mind grows",
  title: "Nodes learn locally. Learning travels. The mind rebalances.",
  steps: [
    {
      title: "Nodes learn locally.",
      body: "A node trains on its own knowledge: field notes, lore, observations, corrections. Nothing leaves the node but a small, signed update that says what changed, never what it was trained on.",
      meta: "training-runtime · signed Ed25519 update",
    },
    {
      title: "Learning travels.",
      body: "Updates arrive at the aggregator, which checks every signature against the node registry and folds the round's updates into a merge candidate, content-addressed so anyone can verify it.",
      meta: "aggregator · merge candidate",
    },
    {
      title: "The mind rebalances.",
      body: "Reviewers approve or reject the candidate; decisions are logged, not overwritten. An approved merge publishes a new global version, a new round opens, and every node re-synchronises.",
      meta: "governance · coordinator · published version",
    },
  ],
};

export const philosophy = {
  index: "04 / Philosophy",
  epigraph: "Technology is a tool for empowerment, not control.",
  attribution: "The World of Eadwyn",
  tenets: [
    {
      title: "No single center.",
      body: "Power that concentrates undermines the system it runs. The federation has no owner node, only roles.",
    },
    {
      title: "Data stays where it grows.",
      body: "Every essential thing is sourced locally. Training is no exception: the knowledge that shapes the mind never leaves the community that made it.",
    },
    {
      title: "Technology serves human judgment.",
      body: "The model supports decisions; people make them. Merges are reviewed by reviewers, and the log of their decisions is public.",
    },
    {
      title: "Resilience over perfection.",
      body: "Any service can be down and the others keep working. Rejected merges are learning, not failure.",
    },
  ],
  link: { label: "Read the philosophy", href: `${SOURCE_URL}/blob/main/docs/philosophy.md` },
};

export const contribute = {
  index: "05 / Contribute",
  title: "Grow the mind.",
  lede: "Four ways in, from a spare laptop to a seat at the review table. Every contribution is recorded and credited.",
  items: [
    {
      title: "Run a node",
      body: "Give the federation compute. A Catalyst Pod, a home server, or a laptop overnight. Register, train on what you hold, submit what you learned.",
      hint: "pnpm demo:round",
      link: {
        label: "Node roles",
        href: `${SOURCE_URL}/blob/main/docs/architecture/node-roles.md`,
      },
    },
    {
      title: "Share knowledge",
      body: "Add field notes, lore, corrections or observations to the knowledge index. Nodes learn from what you share; provenance travels with every merge.",
      hint: "packages/knowledge-index",
      link: { label: "Knowledge index", href: `${SOURCE_URL}/tree/main/packages/knowledge-index` },
    },
    {
      title: "Review merges",
      body: "Join the reviewers who decide what enters the shared model. Read the candidate, check the provenance, record a decision with a rationale.",
      hint: "apps/governance",
      link: { label: "Governance API", href: `${SOURCE_URL}/tree/main/apps/governance` },
    },
    {
      title: "Read the code",
      body: "Everything is public: contracts, services, training recipes and this page. The architecture is meant to be inspected.",
      hint: "docs/architecture",
      link: { label: "Source on GitHub", href: SOURCE_URL },
    },
  ],
};

export const footer = {
  line: "An open, federated mind. Weights, code and training recipes are public.",
  quote: "The future is not a destination, but a journey — a journey we must take together.",
  attribution: "The World of Eadwyn",
  links: [
    { label: "Architecture", href: `${SOURCE_URL}/blob/main/docs/architecture/overview.md` },
    { label: "Node roles", href: `${SOURCE_URL}/blob/main/docs/architecture/node-roles.md` },
    { label: "Philosophy", href: `${SOURCE_URL}/blob/main/docs/philosophy.md` },
    { label: "Source on GitHub", href: SOURCE_URL },
  ],
};
