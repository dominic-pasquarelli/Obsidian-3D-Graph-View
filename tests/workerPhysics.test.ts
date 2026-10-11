import { describe, expect, it } from "vitest";
import { WorkerPhysics } from "../src/controller/WorkerPhysics";
import { defaultForceSettings } from "../src/core/forces/registry";
import type { SimForce, SimulationOptions } from "../src/core/forces/types";
import { buildGraph } from "../src/core/graph/GraphBuilder";
import { allLinks } from "../src/core/graph/types";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance } from "../src/core/perf/scaling";
import type { GraphRenderer } from "../src/renderers/types";
import { ALL_FILTERS, sampleVault } from "./fixtures";

/** Minimal stand-ins for a Worker and a renderer, so WorkerPhysics can be tested in Node. */
function setup() {
	const posted: { kind: string; epoch?: number }[] = [];
	const worker = {
		onmessage: null as ((e: MessageEvent) => void) | null,
		onerror: null as ((e: ErrorEvent) => void) | null,
		postMessage: (msg: { kind: string; epoch?: number }) => void posted.push(msg),
		terminate: () => {},
	};
	const forces = new Map<string, SimForce | null>();
	const sims: Partial<SimulationOptions>[] = [];
	let reheats = 0;
	const renderer = {
		dims: 3,
		engine: { dims: 3, getForce: (n: string) => forces.get(n) ?? undefined, setForce: (n: string, f: SimForce | null) => void forces.set(n, f), setSimulation: (o: Partial<SimulationOptions>) => void sims.push(o) },
		reheat: () => void reheats++,
	} as unknown as GraphRenderer;
	const model = buildGraph(sampleVault(), { filters: ALL_FILTERS });
	const plan = planPerformance(model.nodes.length, model.links.length, DEFAULT_PERFORMANCE_PREFS);
	const physics = new WorkerPhysics("", () => {}, () => worker as unknown as Worker);
	physics.start(renderer, model, allLinks(model), defaultForceSettings(), plan);
	const epoch = posted[0].epoch!;
	const send = (data: object) => worker.onmessage!({ data } as MessageEvent);
	const positions = (value: number) => new Float32Array(model.nodes.length * 3).fill(value);
	const tick = () => (forces.get("workerSync") as SimForce)(1);
	return { physics, posted, sims, model, epoch, send, positions, tick, reheats: () => reheats };
}

let sync: SimForce | null = null;

describe("WorkerPhysics", () => {
	it("applies positions from the current run and ignores a previous run's", () => {
		const t = setup();
		t.send({ kind: "sim:positions", epoch: t.epoch - 1, positions: t.positions(99), done: false });
		t.tick();
		expect(t.model.nodes[0].x).not.toBe(99);
		t.send({ kind: "sim:positions", epoch: t.epoch, positions: t.positions(7), done: false });
		t.tick();
		expect(t.model.nodes[0].x).toBe(7);
	});

	it("keeps rendering when a command races the worker's 'done' message", () => {
		const t = setup();
		// User moves a slider; before the main thread sees it, the worker had already finished.
		t.physics.update(defaultForceSettings(), planPerformance(1, 1, DEFAULT_PERFORMANCE_PREFS));
		t.send({ kind: "sim:positions", epoch: t.epoch, positions: t.positions(1), done: true });
		t.tick(); // applies the last positions and stops the renderer's engine
		expect(t.sims.at(-1)).toEqual({ cooldownTime: 0 });
		const reheatsBefore = t.reheats();
		// The worker resumes because of the slider change and streams again.
		t.send({ kind: "sim:positions", epoch: t.epoch, positions: t.positions(2), done: false });
		expect(t.reheats()).toBe(reheatsBefore + 1);
		expect(t.sims.at(-1)).toEqual({ cooldownTime: 1e12 });
		t.tick();
		expect(t.model.nodes[0].x).toBe(2);
	});

	it("a stop/start cycle ignores positions still in flight from the previous run", () => {
		const t = setup();
		t.physics.stop();
		expect(t.posted.at(-1)?.kind).toBe("sim:stop");
		// Same graph restarts (e.g. after a remount): previous positions must not leak in.
		t.physics.start(
			{ dims: 3, engine: { dims: 3, getForce: () => undefined, setForce: (_n: string, f: SimForce | null) => void (sync = f), setSimulation: () => {} }, reheat: () => {} } as unknown as GraphRenderer,
			t.model,
			allLinks(t.model),
			defaultForceSettings(),
			planPerformance(1, 1, DEFAULT_PERFORMANCE_PREFS),
		);
		const newEpoch = t.posted.at(-1)!.epoch!;
		expect(newEpoch).toBeGreaterThan(t.epoch);
		t.send({ kind: "sim:positions", epoch: t.epoch, positions: t.positions(42), done: false });
		sync!(1);
		expect(t.model.nodes[0].x).not.toBe(42);
		t.send({ kind: "sim:positions", epoch: newEpoch, positions: t.positions(3), done: false });
		sync!(1);
		expect(t.model.nodes[0].x).toBe(3);
	});
});
