import { describe, expect, it } from "vitest";
import { buildGraph, ghostId } from "../src/core/graph/GraphBuilder";
import { ALL_FILTERS, sampleVault } from "./fixtures";

describe("buildGraph", () => {
	it("collapses both directions into one link and keeps reference counts", () => {
		const model = buildGraph(sampleVault(), { filters: ALL_FILTERS });
		const ab = model.links.find((l) => l.id.includes("A.md") && l.id.includes("folder/B.md"))!;
		expect(ab).toBeDefined();
		expect(ab.source).toBe("A.md");
		expect(ab.forward).toBe(3);
		expect(ab.backward).toBe(1);
		expect(model.nodeById.get("A.md")!.outRefs).toBe(3 + 2);
		expect(model.nodeById.get("A.md")!.inRefs).toBe(1);
	});

	it("creates one ghost node per unresolved link text (case-insensitive)", () => {
		const model = buildGraph(sampleVault(), { filters: ALL_FILTERS });
		const ghost = model.nodeById.get(ghostId("Idea"))!;
		expect(ghost.kind).toBe("unresolved");
		expect(ghost.name).toBe("Idea");
		expect(ghost.inRefs).toBe(3);
		expect(ghost.degree).toBe(2);
		expect(model.stats.unresolved).toBe(1);
	});

	it("hides ghosts, attachments and orphans when filtered", () => {
		const model = buildGraph(sampleVault(), {
			filters: { ...ALL_FILTERS, showUnresolved: false, showAttachments: false, showOrphans: false },
		});
		expect(model.nodes.map((n) => n.id).sort()).toEqual(["A.md", "folder/B.md"]);
		expect(model.links).toHaveLength(1);
	});

	it("adds tag nodes and note→tag links when enabled", () => {
		const model = buildGraph(sampleVault(), { filters: { ...ALL_FILTERS, showTags: true } });
		expect(model.nodeById.get("tag:project")?.kind).toBe("tag");
		expect(model.links.filter((l) => l.kind === "tag")).toHaveLength(3);
	});

	it("drops ghost nodes stranded by the include filter", () => {
		const model = buildGraph(sampleVault(), { filters: ALL_FILTERS, includeFile: (f) => f.path !== "A.md" });
		// "Idea" is still referenced by D.md
		expect(model.nodeById.get(ghostId("idea"))?.degree).toBe(1);
		const onlyC = buildGraph(sampleVault(), { filters: ALL_FILTERS, includeFile: (f) => f.path === "C.md" });
		expect(onlyC.nodes.map((n) => n.id)).toEqual(["C.md"]);
	});

	it("reuses previous node objects so positions survive a rebuild", () => {
		const first = buildGraph(sampleVault(), { filters: ALL_FILTERS });
		const a = first.nodeById.get("A.md")!;
		a.x = 42;
		const second = buildGraph(sampleVault(), { filters: ALL_FILTERS, previous: first.nodeById });
		expect(second.nodeById.get("A.md")).toBe(a);
		expect(second.nodeById.get("A.md")!.x).toBe(42);
		expect(second.nodeById.get("A.md")!.outRefs).toBe(5);
	});

	it("ignores self links", () => {
		const vault = sampleVault();
		vault.resolvedLinks["C.md"] = { "C.md": 4 };
		const model = buildGraph(vault, { filters: ALL_FILTERS });
		expect(model.nodeById.get("C.md")!.degree).toBe(0);
	});
});
