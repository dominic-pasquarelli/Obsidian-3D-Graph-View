import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/graph/GraphBuilder";
import type { GraphLink, VaultSnapshot } from "../src/core/graph/types";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance } from "../src/core/perf/scaling";
import { DEFAULT_VIEW_SETTINGS } from "../src/core/settings/view";
import { clone } from "../src/core/util/object";
import { StyleResolver } from "../src/renderers/style";
import { ALL_FILTERS, file } from "./fixtures";

const THEME = { background: "#000000", text: "#ffffff", textMuted: "#777777", accent: "#8a5cf5", isDark: true };

function setup(vault: VaultSnapshot, viewPatch: (v: typeof DEFAULT_VIEW_SETTINGS) => void = () => {}) {
	const model = buildGraph(vault, { filters: ALL_FILTERS });
	const view = clone(DEFAULT_VIEW_SETTINGS);
	viewPatch(view);
	const style = new StyleResolver();
	style.configure(view, planPerformance(model.nodes.length, model.links.length, DEFAULT_PERFORMANCE_PREFS), THEME);
	style.setModel(model);
	const link = (a: string, b: string) => model.links.find((l) => (l.source === a && l.target === b) || (l.source === b && l.target === a)) as GraphLink;
	return { model, style, link, view };
}

const vault: VaultSnapshot = {
	files: ["A", "B", "C", "D"].map((n) => file(`${n}.md`)),
	resolvedLinks: { "A.md": { "B.md": 1, "C.md": 1 }, "B.md": { "A.md": 1 }, "D.md": { "A.md": 1 } },
	unresolvedLinks: {},
};

function colour(model: ReturnType<typeof setup>["model"], id: string, color: string) {
	const n = model.nodeById.get(id)!;
	n.color = color;
	n.group = 0;
}

describe("link colours", () => {
	it("are the neutral link colour unless 'colour links by note group' is on", () => {
		const { model, style, link } = setup(vault);
		colour(model, "A.md", "#ff0000");
		expect(style.linkEnds(link("A.md", "C.md"))).toMatchObject({ source: "#777777", target: "#777777" });
	});

	it("take the colour of the note the link comes from", () => {
		const { model, style, link } = setup(vault, (v) => (v.links.colorByGroup = true));
		colour(model, "A.md", "#ff0000");
		colour(model, "C.md", "#00ff00");
		// A → C (one-way, A links out)
		expect(style.linkEnds(link("A.md", "C.md"))).toMatchObject({ source: "#ff0000", target: "#ff0000" });
		// D → A: D is ungrouped, so the link stays neutral even though A is coloured
		expect(style.linkEnds(link("D.md", "A.md"))).toMatchObject({ source: "#777777", target: "#777777" });
	});

	it("blend two-way links when both directions exist, or use one colour when blending is off", () => {
		const { model, style, link, view } = setup(vault, (v) => (v.links.colorByGroup = true));
		colour(model, "A.md", "#ff0000");
		colour(model, "B.md", "#0000ff");
		const ab = link("A.md", "B.md");
		const ends = style.linkEnds(ab);
		const sourceIsA = (ab.source as string) === "A.md";
		expect(ends.source).toBe(sourceIsA ? "#ff0000" : "#0000ff");
		expect(ends.target).toBe(sourceIsA ? "#0000ff" : "#ff0000");
		expect(style.isGradient(ab)).toBe(true);
		view.links.gradient = false;
		expect(style.isGradient(ab)).toBe(false);
	});
});

describe("labels", () => {
	it("label only the hovered hub and its most connected neighbours", () => {
		const files = [file("Hub.md"), ...Array.from({ length: 40 }, (_, i) => file(`N${i}.md`))];
		const resolvedLinks: Record<string, Record<string, number>> = { "Hub.md": {} };
		files.slice(1).forEach((f, i) => {
			resolvedLinks["Hub.md"][f.path] = 1;
			resolvedLinks[f.path] = i < 3 ? { "N39.md": 1 } : {};
		});
		const { style } = setup({ files, resolvedLinks, unresolvedLinks: {} }, (v) => (v.labels.hoverNeighbours = 5));
		style.setHover("Hub.md");
		const labelled = style.labelledNodes().map((n) => n.id);
		expect(labelled).toHaveLength(6);
		expect(labelled).toContain("Hub.md");
		expect(labelled).toContain("N39.md"); // most connected neighbour
		expect(style.labelPriority(style.model!.nodeById.get("Hub.md")!)).toBeGreaterThan(style.labelPriority(style.model!.nodeById.get("N39.md")!));
	});

	it("show the most connected notes in 2D at any zoom, others only when zoomed in", () => {
		const files = Array.from({ length: 60 }, (_, i) => file(`N${i}.md`));
		const resolvedLinks: Record<string, Record<string, number>> = {};
		// N0..N4 are linked from every other note, so they are the most important.
		files.forEach((f, i) => (resolvedLinks[f.path] = i >= 5 ? { "N0.md": 1, "N1.md": 1, "N2.md": 1, "N3.md": 1, "N4.md": 1 } : {}));
		const { style, model } = setup({ files, resolvedLinks, unresolvedLinks: {} });
		style.setDims(2);
		const zoomedOut = 0.1;
		expect(style.labelAlpha2D(model.nodeById.get("N0.md")!, zoomedOut)).toBe(1);
		expect(style.labelAlpha2D(model.nodeById.get("N59.md")!, zoomedOut)).toBe(0);
		expect(style.labelAlpha2D(model.nodeById.get("N59.md")!, 10)).toBe(1);
	});
});
