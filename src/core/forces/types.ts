import type { Force } from "d3-force-3d";
import type { ComputeExecutor } from "../compute/executor";
import type { TaskInput, TaskName, TaskOutput } from "../compute/tasks";
import type { GraphLink, GraphModel, GraphNode, LinkKind } from "../graph/types";
import type { PerformancePlan } from "../perf/scaling";
import type { ControlSpec } from "../settings/controls";

export type SimForce = Force<GraphNode>;

export interface SimulationOptions {
	alphaDecay: number;
	velocityDecay: number;
	cooldownTime: number;
	warmupTicks: number;
}

/** The slice of a force-directed renderer that force modules may touch. */
export interface ForceEngine {
	readonly dims: 2 | 3;
	getForce(name: string): SimForce | undefined;
	setForce(name: string, force: SimForce | null): void;
	setSimulation(options: Partial<SimulationOptions>): void;
}

export interface LinkPhysics {
	strength(link: GraphLink): number;
	distance(link: GraphLink): number;
}

export interface ForceContext {
	engine: ForceEngine;
	model: GraphModel;
	dims: 2 | 3;
	plan: PerformancePlan;
	/** Registers how links of one kind pull. One link force serves every kind. */
	setLinkPhysics(kind: LinkKind, physics: LinkPhysics): void;
}

export interface AugmentContext {
	model: GraphModel;
	plan: PerformancePlan;
	/** Runs a registered compute task on the main thread or the worker, as the plan decides. */
	compute<K extends TaskName>(task: K, input: TaskInput<K>): Promise<TaskOutput<K>>;
}

/**
 * A pluggable piece of physics. To add one: implement this interface in
 * `modules/`, then list it in `registry.ts`. Its defaults are merged into every
 * saved force profile automatically and its controls appear in the panel.
 */
export interface ForceModule<S extends object = any> {
	id: string;
	label: string;
	description: string;
	defaults: S;
	controls: ControlSpec<S>[];
	/** Install / update / remove this module's forces. Called after every settings change. */
	apply(ctx: ForceContext, settings: S): void;
	/** Optionally contribute extra links (e.g. indirect gravity). */
	augment?(ctx: AugmentContext, settings: S): Promise<GraphLink[]>;
	/** Settings that affect `augment`; augment re-runs only when this key changes. */
	augmentKey?(settings: S): string;
}

export type { ComputeExecutor };
