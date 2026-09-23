/**
 * The layout of the adapter deltas nodes train for the seed model.
 *
 * A rank-8 LoRA on the query and value projections of four blocks of a
 * 64-wide toy model: small enough to aggregate inside a Worker, real enough
 * that FedAvg over it is genuine arithmetic. Real architectures replace this
 * table; the codec and the aggregation do not change.
 */
export const SEED_ADAPTER = {
  architecture: "eadwyn-lm/seed-124m",
  rank: 8,
  hidden: 64,
  blocks: 4,
  targets: ["q_proj", "v_proj"] as const,
};

export function seedAdapterLayout(): Record<string, number[]> {
  const layout: Record<string, number[]> = {};
  for (let block = 0; block < SEED_ADAPTER.blocks; block += 1) {
    for (const target of SEED_ADAPTER.targets) {
      layout[`blocks.${block}.attn.${target}.lora_A`] = [SEED_ADAPTER.rank, SEED_ADAPTER.hidden];
      layout[`blocks.${block}.attn.${target}.lora_B`] = [SEED_ADAPTER.hidden, SEED_ADAPTER.rank];
    }
  }
  return layout;
}
