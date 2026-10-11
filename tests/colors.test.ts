import { describe, expect, it } from "vitest";
import { compileGroups, matchGroup } from "../src/core/color/colorGroups";
import { parseCoreGraphConfig } from "../src/core/color/coreGraph";
import { applyCoreGraphToForces, applyCoreGraphToView } from "../src/core/profiles/coreGraphMapping";
import { defaultForceSettings } from "../src/core/forces/registry";
import { DEFAULT_VIEW_SETTINGS } from "../src/core/settings/view";

const coreJson = {
	collapseFilter: false,
	search: "-path:Archive",
	showTags: true,
	showAttachments: false,
	hideUnresolved: true,
	showOrphans: false,
	colorGroups: [
		{ query: "tag:#project", color: { a: 1, rgb: 14701138 } },
		{ query: "path:Daily", color: { a: 1, rgb: 255 } },
		{ broken: true },
	],
	showArrow: true,
	linkDistance: 250,
	repelStrength: 10,
	centerStrength: 0.5,
	linkStrength: 1,
};

describe("core graph import", () => {
	it("parses colour groups and filters", () => {
		const cfg = parseCoreGraphConfig(coreJson);
		expect(cfg.colorGroups).toEqual([
			{ query: "tag:#project", color: "#e05252", enabled: true },
			{ query: "path:Daily", color: "#0000ff", enabled: true },
		]);
		expect(cfg.search).toBe("-path:Archive");
		expect(cfg.hideUnresolved).toBe(true);
	});

	it("tolerates garbage", () => {
		expect(parseCoreGraphConfig(null).colorGroups).toEqual([]);
		expect(parseCoreGraphConfig({ colorGroups: "nope", linkDistance: "x" }).linkDistance).toBe(250);
	});

	it("maps onto view and force settings", () => {
		const cfg = parseCoreGraphConfig(coreJson);
		const view = applyCoreGraphToView(DEFAULT_VIEW_SETTINGS, cfg);
		expect(view.filters).toEqual({ search: "-path:Archive", showTags: true, showAttachments: false, showUnresolved: false, showOrphans: false });
		expect(view.colors.groups).toHaveLength(2);
		expect(view.links.arrows).toBe(true);
		const forces = applyCoreGraphToForces(defaultForceSettings(), cfg);
		expect(forces.links.distance).toBe(45);
		expect(forces.charge.repel).toBe(60);
	});
});

describe("colour groups", () => {
	it("first matching group wins and disabled groups are skipped", () => {
		const compiled = compileGroups([
			{ query: "tag:#a", color: "#ff0000", enabled: false },
			{ query: "path:Notes", color: "#00ff00", enabled: true },
			{ query: "tag:#a", color: "#0000ff", enabled: true },
		]);
		const hit = matchGroup(compiled, { path: "Notes/x.md", fileName: "x.md", tags: ["a"] });
		expect(hit?.group.color).toBe("#00ff00");
		expect(hit?.index).toBe(1);
		const second = matchGroup(compiled, { path: "y.md", fileName: "y.md", tags: ["a"] });
		expect(second?.index).toBe(2);
	});
});
