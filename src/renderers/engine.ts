import type { ForceEngine, SimForce, SimulationOptions } from "../core/forces/types";

/** The force-related subset shared by 3d-force-graph and force-graph instances. */
export interface ForceGraphLike {
	d3Force(name: string): unknown;
	d3Force(name: string, force: unknown): unknown;
	d3AlphaDecay(v: number): unknown;
	d3VelocityDecay(v: number): unknown;
	cooldownTime(ms: number): unknown;
	warmupTicks(ticks: number): unknown;
}

/** Adapts either library to the ForceEngine interface used by force modules. */
export class LibraryForceEngine implements ForceEngine {
	constructor(
		private readonly graph: ForceGraphLike,
		readonly dims: 2 | 3,
	) {}

	getForce(name: string): SimForce | undefined {
		return (this.graph.d3Force(name) as SimForce | undefined) ?? undefined;
	}

	setForce(name: string, force: SimForce | null): void {
		this.graph.d3Force(name, force);
	}

	setSimulation(o: Partial<SimulationOptions>): void {
		if (o.alphaDecay !== undefined) this.graph.d3AlphaDecay(o.alphaDecay);
		if (o.velocityDecay !== undefined) this.graph.d3VelocityDecay(o.velocityDecay);
		if (o.cooldownTime !== undefined) this.graph.cooldownTime(o.cooldownTime);
		if (o.warmupTicks !== undefined) this.graph.warmupTicks(o.warmupTicks);
	}
}
