/**
 * The aggregation job, identical wherever it runs: inside a Worker or a
 * Workflow step (small adapters), in a Cloudflare Container, or on a Pod GPU.
 *
 * It trusts nothing it reads: the manifest and every delta are checked
 * against the digests that were signed or recorded before the job started.
 */
import {
  type AggregationJobRequest,
  type AggregationJobResult,
  type ArtifactRef,
  MergeManifestSchema,
  sha256Hex,
} from "@eadwyn/shared-protocol";
import { aggregateDeltas, l2Norm } from "./aggregate";
import { decodeSafetensors, encodeSafetensors } from "./safetensors";

export interface AggregationIO {
  read(uri: string): Promise<Uint8Array | null>;
  /** Writes bytes and returns their reference (the writer verifies the digest it is given). */
  write(uri: string, bytes: Uint8Array, sha256: string): Promise<ArtifactRef>;
}

/** Errors that retrying cannot fix: bad digests, malformed files, incompatible shapes. */
export class AggregationInputError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "AggregationInputError";
  }
}

async function readVerified(
  io: AggregationIO,
  ref: ArtifactRef,
  what: string,
): Promise<Uint8Array> {
  const bytes = await io.read(ref.uri);
  if (!bytes) {
    throw new AggregationInputError(`${what} ${ref.uri} is missing`);
  }
  const digest = await sha256Hex(bytes);
  if (bytes.byteLength !== ref.bytes || digest !== ref.sha256) {
    throw new AggregationInputError(
      `${what} ${ref.uri} does not match its recorded digest (${bytes.byteLength} bytes, sha256 ${digest})`,
    );
  }
  return bytes;
}

export async function runAggregationJob(
  io: AggregationIO,
  request: AggregationJobRequest,
  options: { backend?: string; now?: () => number } = {},
): Promise<AggregationJobResult & { l2Norm: number }> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const manifestBytes = await readVerified(io, request.manifest, "manifest");
  const parsed = MergeManifestSchema.safeParse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  if (!parsed.success) {
    throw new AggregationInputError(
      `manifest is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  const manifest = parsed.data;

  const inputs = [];
  for (const input of manifest.inputs) {
    const bytes = await readVerified(io, input.delta, `delta of update ${input.updateId}`);
    try {
      inputs.push({ tensors: decodeSafetensors(bytes).tensors, weight: input.weight });
    } catch (error) {
      throw new AggregationInputError(
        `delta of update ${input.updateId} is not a valid adapter: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let merged: ReturnType<typeof aggregateDeltas>;
  try {
    merged = aggregateDeltas(inputs, manifest.method);
  } catch (error) {
    throw new AggregationInputError(error instanceof Error ? error.message : String(error));
  }
  const output = encodeSafetensors(merged, {
    format: "eadwyn.merged-delta/1",
    candidateId: manifest.candidateId,
    roundId: manifest.roundId,
    baseModelVersion: manifest.baseModelVersion,
    method: manifest.method,
    inputs: String(manifest.inputs.length),
    manifestSha256: request.manifest.sha256,
  });
  const sha256 = await sha256Hex(output);
  const artifact = await io.write(request.outputUri, output, sha256);
  return {
    jobId: request.jobId,
    artifact,
    method: manifest.method,
    inputs: manifest.inputs.length,
    tensors: Object.keys(merged).length,
    backend: options.backend ?? "inline",
    durationMs: Math.max(0, now() - started),
    l2Norm: Math.round(l2Norm(merged) * 1e6) / 1e6,
  };
}
