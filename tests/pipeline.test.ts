import { describe, expect, it } from "vitest";
import { GraphPipeline } from "../src/controller/GraphPipeline";
import type { GraphDataSource } from "../src/controller/ports";
import { AdaptiveExecutor } from "../src/core/compute/executor";
import { defaultForceSettings } from "../src/core/forces/registry";
import { modelFingerprint } from "../src/core/graph/fingerprint";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance } from "../src/core/perf/scaling";
import { DEFAULT_VIEW_SETTINGS } from "../src/core/settings/view";
import { clone } from "../src/core/util/object";
import { file } from "./fixtures";

function source(content: Record<string, string> = {}): GraphDataSource {
	return {
		snapshot: () => ({
			files: [file("A.md", ["#idea"]), file("B.md"), file("C.md"), file("D.md", [], { status: "done" })],
			resolvedLinks: { "A.md": { "B.md": 2, "C.md": 1 }, "B.md": { "D.md": 1 }, "C.md": { "D.md": 1 } },
			unresolvedLinks: { "D.md": { Future: 1 } },
		}),
		onChange: () => () => {},
		readContent: async (path) => content[path] ?? null,
		readCoreGraphConfig: async () => null,
	};
}

describe("GraphPipeline (integration)", () => {
	it("builds, colours and augments a model end to end", async () => {
		const pipeline = new GraphPipeline(source({ "B.md": "talks about recall" }), new AdaptiveExecutor(null));
		const view = clone(DEFAULT_VIEW_SETTINGS);
		const model = await pipeline.buildModel(view, true);
		expect(model.stats.unresolved).toBe(1);

		await pipeline.applyColors(
			model,
			[
				{ query: "tag:#idea", color: "#ff0000", enabled: true },
				{ query: "recall", color: "#00ff00", enabled: true },
				{ query: "[status:done]", color: "#0000ff", enabled: true },
			],
			true,
		);
		expect(model.nodeById.get("A.md")!.color).toBe("#ff0000");
		expect(model.nodeById.get("B.md")!.color).toBe("#00ff00");
		expect(model.nodeById.get("D.md")!.group).toBe(2);
		expect(model.nodeById.get("C.md")!.color).toBeUndefined();

		const forces = defaultForceSettings();
		(forces.indirect as { enabled: boolean }).enabled = true;
		const plan = planPerformance(model.nodes.length, model.links.length, DEFAULT_PERFORMANCE_PREFS);
		const first = await pipeline.augment(model, forces, plan);
		expect(first.links.map((l) => [l.source, l.target])).toEqual([["A.md", "D.md"]]);
		expect(first.ranOn).toBe("main");
		const again = await pipeline.augment(model, forces, plan);
		expect(again.ranOn).toBe("cache");
	});

	it("respects the search filter and content toggle", async () => {
		const pipeline = new GraphPipeline(source({ "B.md": "talks about recall" }), new AdaptiveExecutor(null));
		const view = clone(DEFAULT_VIEW_SETTINGS);
		view.filters.search = "recall OR file:A";
		const withContent = await pipeline.buildModel(view, true);
		expect(withContent.nodes.filter((n) => n.kind === "note").map((n) => n.id).sort()).toEqual(["A.md", "B.md"]);
		const withoutContent = await new GraphPipeline(source({ "B.md": "talks about recall" }), new AdaptiveExecutor(null)).buildModel(view, false);
		expect(withoutContent.nodes.filter((n) => n.kind === "note").map((n) => n.id)).toEqual(["A.md"]);
	});

	it("fingerprint ignores rebuilds that change nothing structural", async () => {
		const pipeline = new GraphPipeline(source(), new AdaptiveExecutor(null));
		const view = clone(DEFAULT_VIEW_SETTINGS);
		const a = await pipeline.buildModel(view, true);
		const fa = modelFingerprint(a);
		const b = await pipeline.buildModel(view, true, a);
		expect(modelFingerprint(b)).toBe(fa);
		b.nodeById.get("A.md")!.color = "#123456";
		expect(modelFingerprint(b)).not.toBe(fa);
	});

	it("ties cached indirect links to the model they were computed for", async () => {
		const pipeline = new GraphPipeline(source(), new AdaptiveExecutor(null));
		const view = clone(DEFAULT_VIEW_SETTINGS);
		const forces = defaultForceSettings();
		(forces.indirect as { enabled: boolean }).enabled = true;
		const first = await pipeline.buildModel(view, true);
		const plan = planPerformance(first.nodes.length, first.links.length, DEFAULT_PERFORMANCE_PREFS);
		// A rebuild lands while the first computation is still running.
		const pending = pipeline.augment(first, forces, plan);
		const second = await pipeline.buildModel(view, true, first);
		expect((await pending).ranOn).toBe("main");
		expect((await pipeline.augment(second, forces, plan)).ranOn).toBe("main");
		expect((await pipeline.augment(second, forces, plan)).ranOn).toBe("cache");
	});

	it("does not write colours when the request went stale", async () => {
		const pipeline = new GraphPipeline(source({ "B.md": "recall" }), new AdaptiveExecutor(null));
		const model = await pipeline.buildModel(clone(DEFAULT_VIEW_SETTINGS), true);
		const applied = await pipeline.applyColors(model, [{ query: "recall", color: "#00ff00", enabled: true }], true, () => false);
		expect(applied).toBe(false);
		expect(model.nodeById.get("B.md")!.color).toBeUndefined();
	});

	it("reads each note once even when stages ask concurrently", async () => {
		const reads: string[] = [];
		const base = source({ "B.md": "recall" });
		const counting: GraphDataSource = {
			...base,
			readContent: async (path) => {
				reads.push(path);
				await new Promise((r) => setTimeout(r, 5));
				return base.readContent(path);
			},
		};
		const pipeline = new GraphPipeline(counting, new AdaptiveExecutor(null));
		const model = await pipeline.buildModel(clone(DEFAULT_VIEW_SETTINGS), true);
		const groups = [{ query: "recall", color: "#00ff00", enabled: true }];
		await Promise.all([pipeline.applyColors(model, groups, true), pipeline.applyColors(model, groups, true)]);
		expect(reads.filter((p) => p === "B.md")).toHaveLength(1);
	});
});
