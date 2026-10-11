import { forceLink, forceSimulation, type LinkForce, type Simulation } from "d3-force-3d";
import { FORCE_MODULES, type ForceSettings } from "../forces/registry";
import type { ForceContext, LinkPhysics, SimForce } from "../forces/types";
import type { GraphLink, GraphModel, GraphNode, IndirectInfo, LinkKind, NodeKind } from "../graph/types";
import type { PerformancePlan } from "../perf/scaling";

/** Plain, postMessage-friendly description of a node for a detached simulation. */
export interface SimNodeData {
	id: string;
	kind: NodeKind;
	degree: number;
	group: number;
	x?: number;
	y?: number;
	z?: number;
	fx?: number;
	fy?: number;
	fz?: number;
}

/** Links reference nodes by index into the node array. */
export interface SimLinkData {
	source: number;
	target: number;
	kind: LinkKind;
	forward: number;
	backward: number;
	indirect?: IndirectInfo;
}

export interface SimInit {
	dims: 2 | 3;
	nodes: SimNodeData[];
	links: SimLinkData[];
	settings: ForceSettings;
	plan: PerformancePlan;
}

export interface SimStep {
	/** x,y,z per node (z = 0 in 2D). */
	positions: Float32Array;
	done: boolean;
}

type SimNode = GraphNode;
type SimLink = GraphLink & { source: SimNode; target: SimNode };

/** Serialises the parts of a model the detached simulation needs. */
export function simInitFromModel(model: GraphModel, links: GraphLink[], dims: 2 | 3, settings: ForceSettings, plan: PerformancePlan): SimInit {
	const index = new Map<string, number>();
	const nodes: SimNodeData[] = model.nodes.map((n, i) => {
		index.set(n.id, i);
		return { id: n.id, kind: n.kind, degree: n.degree, group: n.group, x: n.x, y: n.y, z: n.z, fx: n.fx, fy: n.fy, fz: n.fz };
	});
	const out: SimLinkData[] = [];
	for (const l of links) {
		const s = index.get(typeof l.source === "string" ? l.source : l.source.id);
		const t = index.get(typeof l.target === "string" ? l.target : l.target.id);
		if (s === undefined || t === undefined) continue;
		out.push({ source: s, target: t, kind: l.kind, forward: l.forward, backward: l.backward, indirect: l.indirect });
	}
	return { dims, nodes, links: out, settings, plan };
}

/**
 * A d3-force-3d simulation driven by the same ForceModules as the renderers,
 * but detached from any renderer — so it can run inside a Web Worker and keep
 * the UI smooth on very large graphs.
 */
export class SimulationRunner {
	private sim: Simulation<SimNode> | null = null;
	private nodes: SimNode[] = [];
	private links: SimLink[] = [];
	private dims: 2 | 3 = 3;
	private cooldownTime = 15000;
	private startedAt = 0;
	private dragging = 0;

	init(data: SimInit): void {
		this.dims = data.dims;
		this.nodes = data.nodes.map((n) => ({ ...n, tags: [], name: n.id, inRefs: 0, outRefs: 0 }));
		this.links = data.links.map((l, i) => ({
			id: String(i),
			source: this.nodes[l.source],
			target: this.nodes[l.target],
			kind: l.kind,
			forward: l.forward,
			backward: l.backward,
			indirect: l.indirect,
		}));
		this.sim = forceSimulation<SimNode>(this.nodes, this.dims).stop();
		this.sim.force("link", forceLink<SimNode, SimLink>(this.links));
		this.applySettings(data.settings, data.plan);
	}

	applySettings(settings: ForceSettings, plan: PerformancePlan): void {
		const sim = this.sim;
		if (!sim) return;
		const physics = new Map<LinkKind, LinkPhysics>();
		const ctx: ForceContext = {
			engine: {
				dims: this.dims,
				getForce: (name) => sim.force(name) as SimForce | undefined,
				setForce: (name, force) => void sim.force(name, force),
				setSimulation: (o) => {
					if (o.alphaDecay !== undefined) sim.alphaDecay(o.alphaDecay);
					if (o.velocityDecay !== undefined) sim.velocityDecay(o.velocityDecay);
					if (o.cooldownTime !== undefined) this.cooldownTime = o.cooldownTime;
				},
			},
			model: { nodes: this.nodes, links: this.links, extraLinks: [], nodeById: new Map(), neighbors: new Map(), stats: { notes: 0, unresolved: 0, attachments: 0, tags: 0, links: 0, indirectLinks: 0 } },
			dims: this.dims,
			plan,
			setLinkPhysics: (kind, p) => physics.set(kind, p),
		};
		for (const module of FORCE_MODULES) module.apply(ctx, settings[module.id] ?? module.defaults);
		const link = sim.force("link") as LinkForce<SimNode, SimLink> | undefined;
		link?.strength((l) => physics.get(l.kind)?.strength(l) ?? 0).distance((l) => physics.get(l.kind)?.distance(l) ?? 30);
		this.reheat();
	}

	setGroups(groups: number[]): void {
		groups.forEach((g, i) => {
			if (this.nodes[i]) this.nodes[i].group = g;
		});
	}

	reheat(alpha = 1): void {
		this.sim?.alpha(Math.max(alpha, this.sim.alpha()));
		this.startedAt = Date.now();
	}

	/** Pin (position) or release (null) a node, e.g. while it is dragged. */
	fix(index: number, pos: { x: number; y: number; z?: number } | null, dragging: boolean): void {
		const node = this.nodes[index];
		if (!node || !this.sim) return;
		if (pos) {
			node.fx = node.x = pos.x;
			node.fy = node.y = pos.y;
			if (this.dims === 3) node.fz = node.z = pos.z ?? node.z;
		} else {
			node.fx = node.fy = node.fz = undefined;
		}
		this.dragging = dragging ? 1 : 0;
		this.sim.alphaTarget(dragging ? 0.3 : 0);
		this.reheat(0.3);
	}

	isDone(): boolean {
		if (!this.sim) return true;
		if (this.dragging) return false;
		return this.sim.alpha() < this.sim.alphaMin() || Date.now() - this.startedAt > this.cooldownTime;
	}

	/** Runs as many ticks as fit in `budgetMs` (at least one) and returns positions. */
	step(budgetMs: number): SimStep {
		const sim = this.sim;
		const positions = new Float32Array(this.nodes.length * 3);
		if (!sim) return { positions, done: true };
		const start = Date.now();
		do sim.tick();
		while (Date.now() - start < budgetMs && !this.isDone());
		this.nodes.forEach((n, i) => {
			positions[i * 3] = n.x ?? 0;
			positions[i * 3 + 1] = n.y ?? 0;
			positions[i * 3 + 2] = n.z ?? 0;
		});
		return { positions, done: this.isDone() };
	}
}
