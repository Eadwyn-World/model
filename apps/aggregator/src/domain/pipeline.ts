/**
 * The merge pipeline: aggregate → record checkpoint → forward to governance.
 *
 * One orchestration, two runners: a Cloudflare Workflow (each step's result
 * is persisted; a failed step is retried alone) and an in-process runner on
 * Node. Governance only ever sees a candidate whose merged weights exist.
 */
import { conflict } from "@eadwyn/service-kit";
import {
  type AggregationJobResult,
  type MergeCandidate,
  type MergePipeline,
  mergedDeltaObjectKey,
  storeUri,
} from "@eadwyn/shared-protocol";
import type {
  AggregationBackend,
  AggregatorRepository,
  GovernanceSubmitter,
  StepRunner,
} from "../ports";

export interface PipelineDeps {
  repository: AggregatorRepository;
  backend: AggregationBackend;
  governance: GovernanceSubmitter;
  now: () => Date;
}

export function queuedPipeline(candidateId: string, now: Date): MergePipeline {
  return { id: candidateId, status: "queued", steps: [], updatedAt: now.toISOString() };
}

async function record(
  deps: PipelineDeps,
  candidateId: string,
  change: Partial<MergePipeline> & {
    step?: { name: string; status: "ok" | "failed"; detail?: string };
  },
): Promise<void> {
  const current =
    (await deps.repository.getCandidate(candidateId))?.pipeline ??
    queuedPipeline(candidateId, deps.now());
  const at = deps.now().toISOString();
  const { step, ...rest } = change;
  await deps.repository.savePipeline(candidateId, {
    ...current,
    ...rest,
    steps: step ? [...current.steps, { ...step, at }] : current.steps,
    updatedAt: at,
  });
}

export async function runMergePipeline(
  deps: PipelineDeps,
  candidateId: string,
  step: StepRunner,
): Promise<MergeCandidate> {
  try {
    const candidate = await step.do("load-candidate", async () => {
      const found = await deps.repository.getCandidate(candidateId);
      if (!found)
        throw Object.assign(
          conflict("unknown_candidate", `candidate ${candidateId} does not exist`),
          { retryable: false },
        );
      await record(deps, candidateId, { status: "running" });
      return found.candidate;
    });

    const inputBytes = await step.do("measure-inputs", async () => {
      const updates = await Promise.all(
        candidate.updateIds.map((id) => deps.repository.getUpdate(id)),
      );
      return updates.reduce((sum, u) => sum + (u?.delta.bytes ?? 0), 0);
    });

    const result: AggregationJobResult = await step.do(
      "aggregate",
      async () => {
        const manifest = candidate.manifest ?? candidate.checkpoint;
        const job = {
          jobId: candidateId,
          manifest,
          outputUri: storeUri("checkpoints", mergedDeltaObjectKey(candidate.roundId, candidateId)),
        };
        const aggregated = await deps.backend.aggregate(job, { inputBytes });
        await record(deps, candidateId, {
          step: {
            name: "aggregate",
            status: "ok",
            detail: `${aggregated.backend}: ${aggregated.inputs} deltas, ${aggregated.tensors} tensors in ${aggregated.durationMs} ms`,
          },
        });
        return aggregated;
      },
      { retries: 3, timeoutSeconds: 900 },
    );

    const merged = await step.do("record-checkpoint", async () => {
      const next: MergeCandidate = { ...candidate, checkpoint: result.artifact };
      await deps.repository.saveCandidate(next);
      await record(deps, candidateId, {
        step: { name: "record-checkpoint", status: "ok", detail: result.artifact.uri },
      });
      return next;
    });

    await step.do(
      "forward-to-governance",
      async () => {
        try {
          await deps.governance.submitCandidate(merged);
        } catch (error) {
          // A retry after a lost response: governance already has it.
          if ((error as { code?: string }).code !== "duplicate_candidate") throw error;
        }
        await record(deps, candidateId, {
          status: "forwarded",
          step: { name: "forward-to-governance", status: "ok" },
        });
        return true;
      },
      { retries: 5 },
    );
    return merged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record(deps, candidateId, {
      status: "failed",
      error: message,
      step: { name: "pipeline", status: "failed", detail: message },
    }).catch(() => undefined);
    throw error;
  }
}
