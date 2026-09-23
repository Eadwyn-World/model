/**
 * NodeIdentity — who is training.
 *
 * A node is anything that can hold local data and run a training step:
 * a Catalyst Pod with GPUs, a home server, a laptop overnight, a lab cluster.
 * The identity is public. The private key never leaves the node.
 */
import { z } from "zod";
import { Base64Schema, IsoDateTimeSchema, UuidSchema } from "./primitives";

export const NodeRoleSchema = z.enum(["pod", "home", "device", "lab"]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const NodeComputeSchema = z.enum(["gpu", "cpu", "edge"]);
export type NodeCompute = z.infer<typeof NodeComputeSchema>;

export const NodeCapabilitiesSchema = z.object({
  compute: NodeComputeSchema,
  memoryGb: z.number().positive().optional(),
  /** Largest update (in bytes) this node is willing to upload per round. */
  maxUpdateBytes: z.number().int().positive().optional(),
});
export type NodeCapabilities = z.infer<typeof NodeCapabilitiesSchema>;

export const NodeIdentitySchema = z.object({
  nodeId: UuidSchema,
  displayName: z.string().min(1).max(80),
  role: NodeRoleSchema,
  /** Catalyst Pod this node belongs to, if any. */
  podId: z.string().min(1).max(80).optional(),
  region: z.string().min(1).max(80).optional(),
  /** Ed25519 public key, SPKI DER, base64. Used to verify every update the node signs. */
  publicKey: Base64Schema,
  capabilities: NodeCapabilitiesSchema,
  registeredAt: IsoDateTimeSchema,
  lastSeenAt: IsoDateTimeSchema.optional(),
});
export type NodeIdentity = z.infer<typeof NodeIdentitySchema>;
