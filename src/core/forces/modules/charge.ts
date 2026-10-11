import { forceManyBody } from "d3-force-3d";
import type { GraphNode } from "../../graph/types";
import type { ForceModule } from "../types";

export interface ChargeSettings {
	enabled: boolean;
	/** Repulsion between every pair of nodes. */
	repel: number;
	/** Extra repulsion for well-connected nodes (0 = none). */
	hubBoost: number;
	/** Ignore repulsion beyond this distance (0 = unlimited). Speeds up big graphs. */
	distanceMax: number;
	/** Barnes–Hut accuracy (higher = faster, rougher). */
	theta: number;
}

export const chargeForceModule: ForceModule<ChargeSettings> = {
	id: "charge",
	label: "Repulsion",
	description: "Pushes all notes apart so clusters stay readable.",
	defaults: { enabled: true, repel: 60, hubBoost: 0.2, distanceMax: 0, theta: 0.9 },
	controls: [
		{ type: "toggle", key: "enabled", label: "Enable repulsion" },
		{ type: "slider", key: "repel", label: "Repel force", min: 0, max: 500, step: 5, showIf: (s) => s.enabled },
		{ type: "slider", key: "hubBoost", label: "Hub repulsion boost", min: 0, max: 2, step: 0.05, showIf: (s) => s.enabled },
		{ type: "slider", key: "distanceMax", label: "Max reach (0 = ∞)", min: 0, max: 3000, step: 50, showIf: (s) => s.enabled },
		{ type: "slider", key: "theta", label: "Approximation (theta)", min: 0.5, max: 1.5, step: 0.05, showIf: (s) => s.enabled },
	],
	apply(ctx, s) {
		if (!s.enabled) {
			ctx.engine.setForce("charge", null);
			return;
		}
		const force = forceManyBody<GraphNode>()
			.strength((node) => -s.repel * (1 + s.hubBoost * Math.log2(1 + node.degree)))
			.theta(s.theta)
			.distanceMax(s.distanceMax > 0 ? s.distanceMax : Infinity);
		ctx.engine.setForce("charge", force);
	},
};
