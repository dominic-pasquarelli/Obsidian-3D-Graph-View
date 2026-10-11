import { FORCE_MODULES, type ForceSettings } from "../core/forces/registry";
import type { ForceContext, ForceEngine, LinkPhysics } from "../core/forces/types";
import type { GraphModel, LinkKind } from "../core/graph/types";
import type { PerformancePlan } from "../core/perf/scaling";
import type { GraphRenderer } from "../renderers/types";

/** Force installed by WorkerPhysics; removed whenever physics runs on the main thread. */
export const WORKER_SYNC_FORCE = "workerSync";

/**
 * Applies every force module to a renderer's engine. Modules never touch the
 * shared link force directly; they register per-kind physics and this wires a
 * single strength/distance accessor that dispatches by link kind.
 */
export function applyForces(renderer: GraphRenderer, model: GraphModel, plan: PerformancePlan, settings: ForceSettings): void {
	const physics = new Map<LinkKind, LinkPhysics>();
	const ctx: ForceContext = {
		engine: renderer.engine,
		model,
		dims: renderer.dims,
		plan,
		setLinkPhysics: (kind, p) => physics.set(kind, p),
	};
	renderer.engine.setForce(WORKER_SYNC_FORCE, null);
	for (const module of FORCE_MODULES) module.apply(ctx, settings[module.id] ?? module.defaults);
	const link = renderer.linkForce();
	if (link) {
		link.strength((l) => physics.get(l.kind)?.strength(l) ?? 0).distance((l) => physics.get(l.kind)?.distance(l) ?? 30);
	}
}

/** Names of every d3 force the modules manage (found by applying them to a recording engine). */
export function moduleForceNames(dims: 2 | 3, model: GraphModel, plan: PerformancePlan, settings: ForceSettings): Set<string> {
	const names = new Set<string>(["charge"]);
	const recorder: ForceEngine = { dims, getForce: () => undefined, setForce: (name) => void names.add(name), setSimulation: () => {} };
	const ctx: ForceContext = { engine: recorder, model, dims, plan, setLinkPhysics: () => {} };
	for (const module of FORCE_MODULES) module.apply(ctx, settings[module.id] ?? module.defaults);
	return names;
}

/** Strips the renderer's own physics when a worker simulation drives positions instead. */
export function detachForces(renderer: GraphRenderer, model: GraphModel, plan: PerformancePlan, settings: ForceSettings): void {
	for (const name of moduleForceNames(renderer.dims, model, plan, settings)) renderer.engine.setForce(name, null);
	renderer.linkForce()?.strength(0);
}
