import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/graph/GraphBuilder";
import { FORCE_MODULES, defaultForceSettings } from "../src/core/forces/registry";
import type { ForceContext, LinkPhysics, SimForce, SimulationOptions } from "../src/core/forces/types";
import { linkForceModule } from "../src/core/forces/modules/links";
import { indirectForceModule } from "../src/core/forces/modules/indirect";
import { groupGravityForce } from "../src/core/forces/modules/groups";
import { computeIndirect } from "../src/core/graph/indirect";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance } from "../src/core/perf/scaling";
import type { GraphLink, GraphNode, LinkKind } from "../src/core/graph/types";
import { ALL_FILTERS, file, sampleVault } from "./fixtures";

function fakeContext(dims: 2 | 3 = 3) {
	const forces = new Map<string, SimForce | null>();
	const physics = new Map<LinkKind, LinkPhysics>();
	let sim: Partial<SimulationOptions> = {};
	const model = buildGraph(sampleVault(), { filters: ALL_FILTERS });
	const ctx: ForceContext = {
		engine: {
			dims,
			getForce: (name) => forces.get(name) ?? undefined,
			setForce: (name, f) => void forces.set(name, f),
			setSimulation: (o) => void (sim = { ...sim, ...o }),
		},
		model,
		dims,
		plan: planPerformance(model.nodes.length, model.links.length, DEFAULT_PERFORMANCE_PREFS),
		setLinkPhysics: (kind, p) => void physics.set(kind, p),
	};
	return { ctx, forces, physics, sim: () => sim, model };
}

function resolved(link: GraphLink, model: ReturnType<typeof buildGraph>): GraphLink {
	return { ...link, source: model.nodeById.get(link.source as string)!, target: model.nodeById.get(link.target as string)! };
}

describe("force modules", () => {
	it("every module applies its defaults without throwing, in 2D and 3D", () => {
		for (const dims of [2, 3] as const) {
			const { ctx, forces, sim } = fakeContext(dims);
			const settings = defaultForceSettings();
			for (const m of FORCE_MODULES) m.apply(ctx, settings[m.id]);
			expect(forces.get("charge")).toBeTruthy();
			if (dims === 3) expect(forces.get("gravityZ")).toBeTruthy();
			else expect(forces.get("gravityZ")).toBeNull();
			expect(sim().velocityDecay).toBeDefined();
		}
	});

	it("more references → stronger and shorter springs", () => {
		const { ctx, physics, model } = fakeContext();
		const s = { ...linkForceModule.defaults, normalizeByDegree: false, strength: 0.2 };
		linkForceModule.apply(ctx, s);
		const p = physics.get("direct")!;
		const base = model.links[0];
		const one = resolved({ ...base, forward: 1, backward: 0 }, model);
		const many = resolved({ ...base, forward: 8, backward: 0 }, model);
		expect(p.strength(many)).toBeGreaterThan(p.strength(one));
		expect(p.distance(many)).toBeLessThan(p.distance(one));
		linkForceModule.apply(ctx, { ...s, referenceScale: "off" });
		const flat = physics.get("direct")!;
		expect(flat.strength(many)).toBe(flat.strength(one));
	});

	it("indirect module turns path counts into pull and recomputes only when needed", async () => {
		const vault = {
			files: ["A", "B", "C", "D"].map((n) => file(`${n}.md`)),
			resolvedLinks: { "A.md": { "B.md": 1, "C.md": 1 }, "B.md": { "D.md": 1 }, "C.md": { "D.md": 1 } },
			unresolvedLinks: {},
		};
		const { ctx, physics } = fakeContext();
		const model = buildGraph(vault, { filters: ALL_FILTERS });
		const s = { ...indirectForceModule.defaults, enabled: true };
		const links = await indirectForceModule.augment!(
			{ model, plan: ctx.plan, compute: async (_t, input) => computeIndirect(input) as never },
			s,
		);
		expect(links).toHaveLength(1);
		expect(links[0].indirect).toEqual({ level2: 2, level3: 0 });
		indirectForceModule.apply(ctx, s);
		expect(physics.get("indirect")!.strength(links[0])).toBeGreaterThan(0);
		const key = indirectForceModule.augmentKey!(s);
		expect(indirectForceModule.augmentKey!({ ...s, level2: { ...s.level2, strength: 0.9 } })).toBe(key);
		expect(indirectForceModule.augmentKey!({ ...s, directed: false })).not.toBe(key);
	});

	it("group gravity pulls group members together", () => {
		const nodes = [
			{ id: "a", group: 0, x: -10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
			{ id: "b", group: 0, x: 10, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
			{ id: "c", group: -1, x: 50, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
		] as unknown as GraphNode[];
		const f = groupGravityForce(0.1);
		f.initialize!(nodes, Math.random, 2);
		f(1);
		expect(nodes[0].vx).toBeGreaterThan(0);
		expect(nodes[1].vx).toBeLessThan(0);
		expect(nodes[2].vx).toBe(0);
		expect(nodes[0].vz).toBe(0);
	});
});
