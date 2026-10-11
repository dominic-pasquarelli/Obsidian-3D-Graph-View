import { describe, expect, it } from "vitest";
import { createForceLibrary, createViewLibrary, loadPluginData, serializePluginData } from "../src/core/settings/pluginData";
import { DEFAULT_VIEW_SETTINGS, normalizeViewSettings } from "../src/core/settings/view";
import { normalizeForceSettings } from "../src/core/forces/registry";
import { mergeWithDefaults } from "../src/core/util/object";

describe("settings normalisation", () => {
	it("fills new keys and drops unknown / mistyped ones", () => {
		const merged = mergeWithDefaults({ a: 1, b: { c: true, d: "x" }, list: [1] }, { a: "nope", b: { c: false, extra: 1 }, zzz: 3, list: [4, 5] });
		expect(merged).toEqual({ a: 1, b: { c: false, d: "x" }, list: [4, 5] });
	});

	it("keeps forward compatibility for old force profiles", () => {
		const forces = normalizeForceSettings({ links: { strength: 0.9 }, removedModule: { x: 1 } });
		expect(forces.links.strength).toBe(0.9);
		expect(forces.links.distance).toBe(45);
		expect(forces.indirect).toBeDefined();
		expect("removedModule" in forces).toBe(false);
	});

	it("validates colour groups and colours in view profiles", () => {
		const view = normalizeViewSettings({ mode: "weird", colors: { groups: [{ query: "tag:#x", color: "#ABC" }, { nope: 1 }], note: "red" } });
		expect(view.mode).toBe("3d");
		expect(view.colors.groups).toEqual([{ query: "tag:#x", color: "#aabbcc", enabled: true }]);
		expect(view.colors.note).toBe(DEFAULT_VIEW_SETTINGS.colors.note);
	});
});

describe("ProfileLibrary", () => {
	it("seeds built-ins and supports CRUD", () => {
		const lib = createViewLibrary();
		lib.load(undefined);
		expect(lib.list().length).toBeGreaterThanOrEqual(3);
		const p = lib.create("Mine", { ...DEFAULT_VIEW_SETTINGS, mode: "2d" });
		expect(lib.get(p.id)?.settings.mode).toBe("2d");
		const dupe = lib.create("Mine", DEFAULT_VIEW_SETTINGS);
		expect(dupe.name).toBe("Mine 2");
		expect(lib.rename(p.id, "Renamed")).toBe(true);
		expect(lib.get(p.id)?.name).toBe("Renamed");
		expect(lib.remove(p.id)).toBe(true);
		expect(lib.get(p.id)).toBeUndefined();
	});

	it("never deletes the last profile", () => {
		const lib = createForceLibrary();
		lib.load([{ id: "only", name: "Only", settings: {} }]);
		expect(lib.list()).toHaveLength(1);
		expect(lib.remove("only")).toBe(false);
	});

	it("round-trips export / import and rejects the wrong kind", () => {
		const forces = createForceLibrary();
		forces.load(undefined);
		const first = forces.list()[0];
		const json = forces.exportProfile(first.id)!;
		const imported = forces.importProfile(json);
		expect(imported.settings).toEqual(first.settings);
		expect(imported.id).not.toBe(first.id);
		const views = createViewLibrary();
		views.load(undefined);
		expect(() => views.importProfile(json)).toThrow(/force profile/);
		expect(() => views.importProfile("{oops")).toThrow(/JSON/);
	});

	it("restores built-ins without touching user profiles", () => {
		const lib = createForceLibrary();
		lib.load(undefined);
		const builtIn = lib.list()[0];
		lib.save(builtIn.id, { ...builtIn.settings, charge: { ...builtIn.settings.charge, repel: 1 } });
		const mine = lib.create("Mine", builtIn.settings);
		lib.restoreBuiltIns();
		expect(lib.get(builtIn.id)?.settings.charge.repel).not.toBe(1);
		expect(lib.get(mine.id)).toBeDefined();
	});
});

describe("plugin data", () => {
	it("loads defaults and round-trips", () => {
		const loaded = loadPluginData(null);
		expect(loaded.forces.get(loaded.activeForceProfile)).toBeDefined();
		expect(loaded.views.get(loaded.activeViewProfile)).toBeDefined();
		const again = loadPluginData(JSON.parse(JSON.stringify(serializePluginData(loaded))));
		expect(again.forces.toJSON()).toEqual(loaded.forces.toJSON());
		expect(again.performance).toEqual(loaded.performance);
	});

	it("falls back when the active profile no longer exists", () => {
		const loaded = loadPluginData({ activeViewProfile: "gone" });
		expect(loaded.activeViewProfile).toBe(loaded.views.list()[0].id);
	});
});
