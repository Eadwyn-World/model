import { describe, expect, it } from "vitest";
import { createKnowledgeIndex } from "../index";
import { seedKnowledgeItems } from "../seed";

describe("knowledge index", () => {
  it("loads the seed with every type represented", () => {
    const index = createKnowledgeIndex();
    const stats = index.stats();
    expect(stats.total).toBe(seedKnowledgeItems().length);
    expect(stats.byType["field-note"]).toBeGreaterThan(0);
    expect(stats.byType.lore).toBeGreaterThan(0);
    expect(stats.byType.correction).toBeGreaterThan(0);
    expect(stats.byType.observation).toBeGreaterThan(0);
  });

  it("filters by type, tag and free text", () => {
    const index = createKnowledgeIndex();
    expect(index.list({ type: "correction" }).every((i) => i.type === "correction")).toBe(true);
    expect(index.list({ tag: "resilience" }).length).toBeGreaterThanOrEqual(2);
    expect(index.list({ query: "solar lull" })[0]?.id).toBe("ki-0004");
  });

  it("validates additions and refuses duplicates", () => {
    const index = createKnowledgeIndex([]);
    const added = index.add({
      id: "ki-test",
      title: "Test note",
      type: "field-note",
      source: { kind: "contributor", ref: "c-test" },
      summary: "A note.",
      tags: ["test"],
      contributor: { id: "c-test", displayName: "Tester" },
      createdAt: "2026-09-20T10:00:00Z",
    });
    expect(added.status).toBe("accepted");
    expect(() => index.add({ ...added })).toThrow(/duplicate/);
    expect(() => index.add({ ...added, id: "not valid" })).toThrow();
  });
});
