/**
 * Dynamic scaling: picks level-of-detail and compute strategy from graph size,
 * so the same code path stays responsive from a 50-note vault to 50k+ notes.
 */

export type PerfTier = "small" | "medium" | "large" | "huge";
export type PerfMode = "auto" | "quality" | "performance";
export type WorkerMode = "auto" | "always" | "never";
export type PhysicsMode = "auto" | "main" | "worker";

export interface PerformancePrefs {
	/** auto: follow graph size. quality: one tier more detail. performance: one tier less. */
	mode: PerfMode;
	workerMode: WorkerMode;
	/** Graph load (nodes + links/2) at which "auto" moves heavy maths to a Web Worker. */
	workerThreshold: number;
	/** Where the force simulation runs. auto = worker for large graphs. */
	physicsMode: PhysicsMode;
	/** Graph load at which "auto" moves the force simulation to a Web Worker. */
	physicsThreshold: number;
}

export interface PerformancePlan {
	tier: PerfTier;
	load: number;
	useWorker: boolean;
	/** Run the force simulation in a Web Worker (UI stays smooth on big graphs). */
	physicsInWorker: boolean;
	/** Draw ordinary 3D links as one batched object instead of one object per link. */
	batchLinks: boolean;
	/** Multiplier on link opacity: dense graphs need fainter links to stay readable. */
	linkOpacityScale: number;
	/** Sphere segments for 3D nodes. */
	nodeResolution: number;
	/** Max number of always-visible text labels. */
	labelBudget: number;
	allowParticles: boolean;
	allowBloom: boolean;
	allowArrows: boolean;
	/** Physics runs at most this long before freezing (ms). */
	cooldownTime: number;
	warmupTicks: number;
	alphaDecay: number;
	/** Default hub cap for indirect links when the profile says "auto" (0). */
	hubCap: number;
	/** Default per-source work budget for indirect level-3 walks. */
	workBudgetPerNode: number;
}

export const DEFAULT_PERFORMANCE_PREFS: PerformancePrefs = {
	mode: "auto",
	workerMode: "auto",
	workerThreshold: 3000,
	physicsMode: "auto",
	physicsThreshold: 4000,
};

const TIERS: PerfTier[] = ["small", "medium", "large", "huge"];

export function graphLoad(nodes: number, links: number): number {
	return nodes + links / 2;
}

export function tierForLoad(load: number): PerfTier {
	if (load < 2000) return "small";
	if (load < 8000) return "medium";
	if (load < 30000) return "large";
	return "huge";
}

const PLANS: Record<PerfTier, Omit<PerformancePlan, "tier" | "load" | "useWorker" | "physicsInWorker">> = {
	small: {
		batchLinks: false,
		linkOpacityScale: 1,
		nodeResolution: 16,
		labelBudget: 400,
		allowParticles: true,
		allowBloom: true,
		allowArrows: true,
		cooldownTime: 15000,
		warmupTicks: 0,
		alphaDecay: 0.0228,
		hubCap: 250,
		workBudgetPerNode: 200000,
	},
	medium: {
		batchLinks: false,
		linkOpacityScale: 0.85,
		nodeResolution: 10,
		labelBudget: 200,
		allowParticles: true,
		allowBloom: true,
		allowArrows: true,
		cooldownTime: 12000,
		warmupTicks: 0,
		alphaDecay: 0.03,
		hubCap: 150,
		workBudgetPerNode: 100000,
	},
	large: {
		batchLinks: true,
		linkOpacityScale: 0.6,
		nodeResolution: 6,
		labelBudget: 80,
		allowParticles: false,
		allowBloom: true,
		allowArrows: false,
		cooldownTime: 9000,
		warmupTicks: 0,
		alphaDecay: 0.04,
		hubCap: 80,
		workBudgetPerNode: 40000,
	},
	huge: {
		batchLinks: true,
		linkOpacityScale: 0.4,
		nodeResolution: 4,
		labelBudget: 30,
		allowParticles: false,
		allowBloom: false,
		allowArrows: false,
		cooldownTime: 6000,
		warmupTicks: 0,
		alphaDecay: 0.06,
		hubCap: 40,
		workBudgetPerNode: 15000,
	},
};

export function planPerformance(nodes: number, links: number, prefs: PerformancePrefs): PerformancePlan {
	const load = graphLoad(nodes, links);
	let idx = TIERS.indexOf(tierForLoad(load));
	if (prefs.mode === "quality") idx = Math.max(0, idx - 1);
	if (prefs.mode === "performance") idx = Math.min(TIERS.length - 1, idx + 1);
	const tier = TIERS[idx];
	const useWorker =
		prefs.workerMode === "always" ? true : prefs.workerMode === "never" ? false : load >= prefs.workerThreshold;
	const physicsInWorker =
		prefs.physicsMode === "worker" ? true : prefs.physicsMode === "main" ? false : load >= prefs.physicsThreshold;
	return { tier, load, useWorker, physicsInWorker, ...PLANS[tier] };
}
