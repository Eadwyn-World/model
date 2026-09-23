import { describe, expect, it } from "vitest";
import {
  sampleFederationStats,
  sampleGovernanceDecision,
  sampleMergeCandidate,
  sampleModelVersion,
  sampleNodeIdentity,
  sampleTrainingUpdate,
} from "../fixtures";
import {
  bumpVersion,
  canonicalJson,
  compareVersions,
  FederationStatsSchema,
  GovernanceDecisionSchema,
  MergeCandidateSchema,
  ModelVersionSchema,
  NodeIdentitySchema,
  RegisterNodeRequestSchema,
  TrainingUpdateSchema,
  trainingUpdateSigningPayload,
} from "../index";
import { generateNodeKeyPair, signTrainingUpdate, verifyTrainingUpdateSignature } from "../signing";

describe("shared contracts", () => {
  it("accepts every fixture", () => {
    expect(NodeIdentitySchema.safeParse(sampleNodeIdentity()).success).toBe(true);
    expect(TrainingUpdateSchema.safeParse(sampleTrainingUpdate()).success).toBe(true);
    expect(MergeCandidateSchema.safeParse(sampleMergeCandidate()).success).toBe(true);
    expect(GovernanceDecisionSchema.safeParse(sampleGovernanceDecision()).success).toBe(true);
    expect(ModelVersionSchema.safeParse(sampleModelVersion()).success).toBe(true);
    expect(FederationStatsSchema.safeParse(sampleFederationStats()).success).toBe(true);
  });

  it("rejects an update whose delta is not content-addressed", () => {
    const update = sampleTrainingUpdate();
    const result = TrainingUpdateSchema.safeParse({
      ...update,
      delta: { ...update.delta, sha256: "not-a-digest" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["delta", "sha256"]);
    }
  });

  it("strips server-assigned fields from a registration request", () => {
    const parsed = RegisterNodeRequestSchema.parse(sampleNodeIdentity());
    expect(parsed).not.toHaveProperty("nodeId");
    expect(parsed).not.toHaveProperty("registeredAt");
  });

  it("defaults knowledgeItemIds so provenance is never undefined", () => {
    const { knowledgeItemIds: _omitted, ...update } = sampleTrainingUpdate();
    expect(TrainingUpdateSchema.parse(update).knowledgeItemIds).toEqual([]);
  });
});

describe("canonical json", () => {
  it("orders keys deterministically", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}',
    );
  });

  it("produces the same signing payload regardless of key order", () => {
    const update = sampleTrainingUpdate();
    const { signature: _signature, ...unsigned } = update;
    const reordered = Object.fromEntries(Object.entries(unsigned).reverse()) as typeof unsigned;
    expect(trainingUpdateSigningPayload(reordered)).toBe(trainingUpdateSigningPayload(unsigned));
  });
});

describe("signing", () => {
  it("round-trips an Ed25519 signature and detects tampering", () => {
    const keys = generateNodeKeyPair();
    const { signature: _signature, ...unsigned } = sampleTrainingUpdate();
    const signature = signTrainingUpdate(unsigned, keys.privateKey);
    const signed = { ...unsigned, signature };

    expect(verifyTrainingUpdateSignature(signed, keys.publicKey)).toBe(true);
    expect(
      verifyTrainingUpdateSignature(
        { ...signed, metrics: { ...signed.metrics, samples: 999_999 } },
        keys.publicKey,
      ),
    ).toBe(false);
    expect(verifyTrainingUpdateSignature(signed, generateNodeKeyPair().publicKey)).toBe(false);
  });
});

describe("versions", () => {
  it("compares and bumps", () => {
    expect(compareVersions("0.3.1", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(bumpVersion("0.3.1", "minor")).toBe("0.4.0");
    expect(bumpVersion("0.3.1", "patch")).toBe("0.3.2");
    expect(bumpVersion("0.3.1", "major")).toBe("1.0.0");
  });
});
