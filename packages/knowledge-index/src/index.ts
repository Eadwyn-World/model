/**
 * In-memory knowledge index over validated items.
 *
 * Persistence is intentionally out of scope for this milestone: the index is
 * a pure structure that a node runtime or a service can load, query and
 * extend. Wiring it to a store is a one-function change (see `toJSON`).
 */
import { seedKnowledgeItems } from "./seed";
import {
  type KnowledgeItem,
  type KnowledgeItemInput,
  KnowledgeItemSchema,
  type KnowledgeStatus,
  type KnowledgeType,
  KnowledgeTypeSchema,
} from "./types";

export * from "./seed";
export * from "./types";

export interface KnowledgeFilter {
  type?: KnowledgeType;
  tag?: string;
  status?: KnowledgeStatus;
  /** Case-insensitive match against title and summary. */
  query?: string;
  contributorId?: string;
}

export interface KnowledgeStats {
  total: number;
  byType: Record<KnowledgeType, number>;
  byStatus: Record<KnowledgeStatus, number>;
  contributors: number;
  tags: number;
}

export interface KnowledgeIndex {
  list(filter?: KnowledgeFilter): KnowledgeItem[];
  get(id: string): KnowledgeItem | undefined;
  /** Validates and adds an item. Throws on an invalid shape or a duplicate id. */
  add(input: KnowledgeItemInput): KnowledgeItem;
  stats(): KnowledgeStats;
  toJSON(): KnowledgeItem[];
}

export function createKnowledgeIndex(
  items: KnowledgeItemInput[] = seedKnowledgeItems(),
): KnowledgeIndex {
  const byId = new Map<string, KnowledgeItem>();
  for (const item of items) {
    const parsed = KnowledgeItemSchema.parse(item);
    if (byId.has(parsed.id)) {
      throw new Error(`duplicate knowledge item id: ${parsed.id}`);
    }
    byId.set(parsed.id, parsed);
  }

  const all = () =>
    [...byId.values()].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
    );

  return {
    list(filter = {}) {
      const query = filter.query?.trim().toLowerCase();
      return all().filter((item) => {
        if (filter.type && item.type !== filter.type) return false;
        if (filter.status && item.status !== filter.status) return false;
        if (filter.tag && !item.tags.includes(filter.tag)) return false;
        if (filter.contributorId && item.contributor.id !== filter.contributorId) return false;
        if (query) {
          const haystack = `${item.title} ${item.summary}`.toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        return true;
      });
    },
    get(id) {
      return byId.get(id);
    },
    add(input) {
      const parsed = KnowledgeItemSchema.parse(input);
      if (byId.has(parsed.id)) {
        throw new Error(`duplicate knowledge item id: ${parsed.id}`);
      }
      if (parsed.supersedes && !byId.has(parsed.supersedes)) {
        throw new Error(`cannot supersede unknown item ${parsed.supersedes}`);
      }
      byId.set(parsed.id, parsed);
      return parsed;
    },
    stats() {
      const byType = Object.fromEntries(
        KnowledgeTypeSchema.options.map((type) => [type, 0]),
      ) as Record<KnowledgeType, number>;
      const byStatus: Record<KnowledgeStatus, number> = { proposed: 0, accepted: 0, merged: 0 };
      const contributors = new Set<string>();
      const tags = new Set<string>();
      for (const item of byId.values()) {
        byType[item.type] += 1;
        byStatus[item.status] += 1;
        contributors.add(item.contributor.id);
        for (const tag of item.tags) tags.add(tag);
      }
      return {
        total: byId.size,
        byType,
        byStatus,
        contributors: contributors.size,
        tags: tags.size,
      };
    },
    toJSON() {
      return all();
    },
  };
}
