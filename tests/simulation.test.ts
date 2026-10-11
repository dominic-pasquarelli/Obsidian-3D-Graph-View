import { describe, expect, it } from "vitest";
import { defaultForceSettings } from "../src/core/forces/registry";
import { buildGraph } from "../src/core/graph/GraphBuilder";
import { allLinks } from "../src/core/graph/types";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance } from "../src/core/perf/scaling";
import { SimulationRunner, simInitFromModel } from "../src/core/physics/SimulationRunner";
import { ALL_FILTERS, sampleVault } from "./fixtures";

function setup(dims: 2 | 3) {
	const model = buildGraph(sampleVault(), { filters: ALL_FILTERS });
	const plan = planPerformance(model.nodes.length, model.links.length, DEFAULT_PERFORMANCE_PREFS);
	const runner = new SimulationRunner();
	runner.init(simInitFromModel(model, allLinks(model), dims, defaultForceSettings(), plan));
	return { model, runner, plan };
}

describe("SimulationRunner (worker physics)", () => {
	it("lays out nodes with the same force modules and eventually settles", () => {
		const { model, runner } = setup(3);
		let step = runner.step(5);
		expect(step.positions.length).toBe(model.nodes.length * 3);
		expect(Array.from(step.positions).every(Number.isFinite)).toBe(true);
		for (let i = 0; i < 400 && !step.done; i++) step = runner.step(50);
		expect(step.done).toBe(true);
	});

	it("keeps z at 0 in 2D and pulls linked notes closer than unlinked ones", () => {
		const { model, runner } = setup(2);
		let step = runner.step(5);
		for (let i = 0; i < 400 && !step.done; i++) step = runner.step(50);
		const idx = (id: string) => model.nodes.findIndex((n) => n.id === id);
		const pos = (i: number) => [step.positions[i * 3], step.positions[i * 3 + 1], step.positions[i * 3 + 2]];
		const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
		for (let i = 0; i < model.nodes.length; i++) expect(step.positions[i * 3 + 2]).toBe(0);
		const a = pos(idx("A.md"));
		expect(dist(a, pos(idx("folder/B.md")))).toBeLessThan(dist(a, pos(idx("C.md"))));
	});

	it("pins dragged nodes and wakes up after settling", () => {
		const { runner } = setup(3);
		let step = runner.step(5);
		for (let i = 0; i < 400 && !step.done; i++) step = runner.step(50);
		runner.fix(0, { x: 500, y: -200, z: 10 }, true);
		step = runner.step(5);
		expect(step.done).toBe(false);
		expect([step.positions[0], step.positions[1], step.positions[2]]).toEqual([500, -200, 10]);
		runner.fix(0, null, false);
		expect(runner.isDone()).toBe(false);
	});
});
