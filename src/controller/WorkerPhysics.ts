import type { ForceSettings } from "../core/forces/registry";
import type { SimForce } from "../core/forces/types";
import type { GraphLink, GraphModel, GraphNode } from "../core/graph/types";
import type { PerformancePlan } from "../core/perf/scaling";
import { simInitFromModel } from "../core/physics/SimulationRunner";
import type { GraphRenderer } from "../renderers/types";
import { WORKER_SYNC_FORCE } from "./ForceCoordinator";

const RUN_FOREVER = 1e12;

/**
 * Runs the force simulation in a Web Worker and streams positions back.
 * The renderer's own engine keeps "ticking" with no forces, just copying the
 * latest positions — so rendering stays at full frame rate however large the
 * graph is. Uses the exact same force modules as main-thread physics.
 */
export class WorkerPhysics {
	private worker: Worker | null = null;
	private url: string | null = null;
	private renderer: GraphRenderer | null = null;
	private nodes: GraphNode[] = [];
	private index = new Map<GraphNode, number>();
	private latest: Float32Array | null = null;
	private finished = false;
	private active = false;
	/** Bumped on every start(); worker messages from an older run are ignored. */
	private epoch = 0;

	constructor(
		private readonly source: string,
		private readonly onFailure: (err: Error) => void,
	) {}

	get running(): boolean {
		return this.active;
	}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.url = URL.createObjectURL(new Blob([this.source], { type: "text/javascript" }));
		const worker = new Worker(this.url);
		worker.onmessage = (e: MessageEvent) => {
			const data = e.data as { kind?: string; epoch?: number; positions?: Float32Array; done?: boolean; error?: string };
			if (data.epoch !== this.epoch) return; // left over from a previous graph / node order
			if (data.kind === "sim:positions" && data.positions) {
				this.latest = data.positions;
				if (data.done) this.finished = true;
			} else if (data.kind === "sim:error") this.fail(new Error(data.error ?? "Physics worker error"));
		};
		worker.onerror = (e) => this.fail(new Error(e.message || "Physics worker error"));
		this.worker = worker;
		return worker;
	}

	private fail(err: Error): void {
		console.error("[3d-graph-view] physics worker failed", err);
		this.dispose();
		this.onFailure(err);
	}

	/** (Re)starts the worker simulation for this renderer and data. */
	start(renderer: GraphRenderer, model: GraphModel, links: GraphLink[], settings: ForceSettings, plan: PerformancePlan): void {
		const worker = this.ensureWorker();
		this.renderer = renderer;
		this.nodes = model.nodes;
		this.index = new Map(model.nodes.map((n, i) => [n, i]));
		this.latest = null;
		this.finished = false;
		this.active = true;
		this.epoch++;
		worker.postMessage({ kind: "sim:init", epoch: this.epoch, init: simInitFromModel(model, links, renderer.dims, settings, plan) });
		renderer.engine.setForce(WORKER_SYNC_FORCE, this.syncForce());
		renderer.engine.setSimulation({ alphaDecay: 0, cooldownTime: RUN_FOREVER, warmupTicks: 0 });
		renderer.reheat();
	}

	update(settings: ForceSettings, plan: PerformancePlan): void {
		if (!this.active) return;
		this.worker?.postMessage({ kind: "sim:settings", settings, plan, groups: this.nodes.map((n) => n.group) });
		this.wake();
	}

	/** Mirrors a node's pinned state (drag, pin, unpin) into the worker. */
	fix(node: GraphNode, dragging: boolean): void {
		const i = this.index.get(node);
		if (!this.active || i === undefined) return;
		const pos = node.fx !== undefined && node.fx !== null ? { x: node.fx, y: node.fy ?? node.y ?? 0, z: node.fz ?? node.z ?? 0 } : null;
		this.worker?.postMessage({ kind: "sim:fix", index: i, pos, dragging });
		this.wake();
	}

	reheat(): void {
		if (!this.active) return;
		this.worker?.postMessage({ kind: "sim:reheat" });
		this.wake();
	}

	private wake(): void {
		if (!this.finished || !this.renderer) return;
		this.finished = false;
		this.renderer.engine.setSimulation({ cooldownTime: RUN_FOREVER });
		this.renderer.reheat();
	}

	/** d3 force run by the renderer each tick: copy the newest worker positions into the nodes. */
	private syncForce(): SimForce {
		const force = (() => {
			const buf = this.latest;
			if (buf) {
				this.latest = null;
				const nodes = this.nodes;
				const n = Math.min(nodes.length, buf.length / 3);
				for (let i = 0; i < n; i++) {
					const node = nodes[i];
					node.vx = node.vy = node.vz = 0;
					if (node.fx !== undefined && node.fx !== null) continue; // being dragged / pinned on this side
					node.x = buf[i * 3];
					node.y = buf[i * 3 + 1];
					if (this.renderer?.dims === 3) node.z = buf[i * 3 + 2];
				}
			}
			if (this.finished && !this.latest && this.renderer) this.renderer.engine.setSimulation({ cooldownTime: 0 });
		}) as SimForce;
		force.initialize = () => {};
		return force;
	}

	/** Stops the worker simulation and removes the sync force (main-thread physics takes over). */
	stop(): void {
		if (!this.active) return;
		this.active = false;
		this.epoch++;
		this.worker?.postMessage({ kind: "sim:stop" });
		this.renderer?.engine.setForce(WORKER_SYNC_FORCE, null);
		this.renderer = null;
	}

	dispose(): void {
		this.active = false;
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
		this.renderer = null;
	}
}
