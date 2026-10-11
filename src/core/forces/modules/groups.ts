import type { GraphNode } from "../../graph/types";
import type { ForceModule, SimForce } from "../types";

export interface GroupGravitySettings {
	enabled: boolean;
	/** Pull towards the centre of the node's colour group. */
	strength: number;
}

/** Custom d3 force: nodes drift towards the centroid of their colour group. Works in 2D and 3D. */
export function groupGravityForce(strength: number): SimForce {
	let nodes: GraphNode[] = [];
	let dims = 3;
	const force = ((alpha: number) => {
		const sums = new Map<number, { x: number; y: number; z: number; n: number }>();
		for (const node of nodes) {
			if (node.group < 0) continue;
			let s = sums.get(node.group);
			if (!s) sums.set(node.group, (s = { x: 0, y: 0, z: 0, n: 0 }));
			s.x += node.x ?? 0;
			s.y += node.y ?? 0;
			s.z += node.z ?? 0;
			s.n++;
		}
		const k = strength * alpha;
		for (const node of nodes) {
			if (node.group < 0) continue;
			const s = sums.get(node.group)!;
			if (s.n < 2) continue;
			node.vx = (node.vx ?? 0) + (s.x / s.n - (node.x ?? 0)) * k;
			node.vy = (node.vy ?? 0) + (s.y / s.n - (node.y ?? 0)) * k;
			if (dims > 2) node.vz = (node.vz ?? 0) + (s.z / s.n - (node.z ?? 0)) * k;
		}
	}) as SimForce;
	force.initialize = (n: GraphNode[], _random: () => number, numDimensions: number) => {
		nodes = n;
		dims = numDimensions ?? 3;
	};
	return force;
}

export const groupGravityModule: ForceModule<GroupGravitySettings> = {
	id: "groups",
	label: "Colour-group gravity",
	description: "Notes in the same colour group (e.g. imported from the core graph) attract each other, so classifications form visible regions.",
	defaults: { enabled: false, strength: 0.05 },
	controls: [
		{ type: "toggle", key: "enabled", label: "Enable group gravity" },
		{ type: "slider", key: "strength", label: "Strength", min: 0, max: 0.5, step: 0.005, showIf: (s) => s.enabled },
	],
	apply(ctx, s) {
		ctx.engine.setForce("groups", s.enabled && s.strength > 0 ? groupGravityForce(s.strength) : null);
	},
};
