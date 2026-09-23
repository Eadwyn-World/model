import { randomUUID } from "node:crypto";
import type { NodeIdentity, RegisterNodeRequestSchema } from "@eadwyn/shared-protocol";
import type { z } from "zod";
import type { CoordinatorState } from "../state";

type RegisterNodeInput = z.output<typeof RegisterNodeRequestSchema>;

/**
 * Registers a node. Registration is idempotent on the public key: the same key
 * always maps to the same nodeId, so a node that restarts keeps its identity.
 */
export function registerNode(
  state: CoordinatorState,
  input: RegisterNodeInput,
  now: Date,
): { node: NodeIdentity; created: boolean } {
  const existing = state.nodes.find((n) => n.publicKey === input.publicKey);
  if (existing) {
    existing.displayName = input.displayName;
    existing.role = input.role;
    existing.podId = input.podId;
    existing.region = input.region;
    existing.capabilities = input.capabilities;
    existing.lastSeenAt = now.toISOString();
    return { node: existing, created: false };
  }
  const node: NodeIdentity = {
    nodeId: randomUUID(),
    displayName: input.displayName,
    role: input.role,
    podId: input.podId,
    region: input.region,
    publicKey: input.publicKey,
    capabilities: input.capabilities,
    registeredAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  };
  state.nodes.push(node);
  return { node, created: true };
}

export function findNode(state: CoordinatorState, nodeId: string): NodeIdentity | undefined {
  return state.nodes.find((n) => n.nodeId === nodeId);
}

export function touchNode(
  state: CoordinatorState,
  nodeId: string,
  now: Date,
): NodeIdentity | undefined {
  const node = findNode(state, nodeId);
  if (node) {
    node.lastSeenAt = now.toISOString();
  }
  return node;
}

export function countOnlineNodes(nodes: NodeIdentity[], now: Date, windowMinutes: number): number {
  const threshold = now.getTime() - windowMinutes * 60_000;
  return nodes.filter((n) => n.lastSeenAt && new Date(n.lastSeenAt).getTime() >= threshold).length;
}
