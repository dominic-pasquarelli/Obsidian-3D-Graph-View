import type { ForceModule } from "../types";

export interface SimulationSettings {
	/** Friction: higher settles faster but can freeze early. */
	velocityDecay: number;
	/** Multiplies the size-based cooling rate (higher = settles sooner). */
	coolingSpeed: number;
	/** Seconds the physics keeps running after a change (0 = automatic). */
	cooldownSeconds: number;
}

export const simulationModule: ForceModule<SimulationSettings> = {
	id: "simulation",
	label: "Simulation",
	description: "How the physics settles. Automatic values adapt to graph size.",
	defaults: { velocityDecay: 0.4, coolingSpeed: 1, cooldownSeconds: 0 },
	controls: [
		{ type: "slider", key: "velocityDecay", label: "Friction", min: 0.05, max: 0.9, step: 0.05 },
		{ type: "slider", key: "coolingSpeed", label: "Cooling speed", min: 0.25, max: 4, step: 0.25 },
		{ type: "slider", key: "cooldownSeconds", label: "Run time in seconds (0 = auto)", min: 0, max: 120, step: 1 },
	],
	apply(ctx, s) {
		ctx.engine.setSimulation({
			velocityDecay: s.velocityDecay,
			alphaDecay: Math.min(0.5, ctx.plan.alphaDecay * s.coolingSpeed),
			cooldownTime: s.cooldownSeconds > 0 ? s.cooldownSeconds * 1000 : ctx.plan.cooldownTime,
			warmupTicks: ctx.plan.warmupTicks,
		});
	},
};
