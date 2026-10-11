/**
 * Reference-count → pull-strength maths. Shared by direct-link weighting and
 * indirect-link gravity so both respond to counts in the same way.
 */

export type ScaleMode = "off" | "linear" | "sqrt" | "log";
export type CombineMode = "sum" | "max";

export const SCALE_MODE_LABELS: Record<ScaleMode, string> = {
	off: "Off (every link equal)",
	linear: "Linear",
	sqrt: "Square root",
	log: "Logarithmic",
};

/** Maps a count ≥ 1 to a growth factor ≥ 1 (count 1 → 1 for every mode). */
export function scaleCount(count: number, mode: ScaleMode): number {
	if (count <= 0) return 0;
	switch (mode) {
		case "off":
			return 1;
		case "linear":
			return count;
		case "sqrt":
			return Math.sqrt(count);
		case "log":
			return 1 + Math.log2(count);
	}
}

/**
 * Multiplier applied to a link's base strength.
 * influence = 0 ignores counts, 1 applies the scaled count fully; result is capped.
 */
export function referenceMultiplier(count: number, mode: ScaleMode, influence: number, maxMultiplier: number): number {
	const scaled = scaleCount(Math.max(1, count), mode);
	const m = 1 + influence * (scaled - 1);
	return Math.max(0, Math.min(m, Math.max(1, maxMultiplier)));
}

export function combineCounts(forward: number, backward: number, mode: CombineMode): number {
	return mode === "max" ? Math.max(forward, backward) : forward + backward;
}
