import { describe, expect, it } from "vitest";
import { DEFAULT_PERFORMANCE_PREFS, planPerformance, tierForLoad } from "../src/core/perf/scaling";

describe("performance planning", () => {
	it("picks tiers by load", () => {
		expect(tierForLoad(100)).toBe("small");
		expect(tierForLoad(5000)).toBe("medium");
		expect(tierForLoad(20000)).toBe("large");
		expect(tierForLoad(100000)).toBe("huge");
	});

	it("uses the worker above the threshold in auto mode", () => {
		expect(planPerformance(500, 1000, DEFAULT_PERFORMANCE_PREFS).useWorker).toBe(false);
		expect(planPerformance(5000, 10000, DEFAULT_PERFORMANCE_PREFS).useWorker).toBe(true);
		expect(planPerformance(10, 10, { ...DEFAULT_PERFORMANCE_PREFS, workerMode: "always" }).useWorker).toBe(true);
		expect(planPerformance(1e6, 1e6, { ...DEFAULT_PERFORMANCE_PREFS, workerMode: "never" }).useWorker).toBe(false);
	});

	it("quality / performance modes shift the tier", () => {
		expect(planPerformance(5000, 0, { ...DEFAULT_PERFORMANCE_PREFS, mode: "quality" }).tier).toBe("small");
		expect(planPerformance(5000, 0, { ...DEFAULT_PERFORMANCE_PREFS, mode: "performance" }).tier).toBe("large");
		expect(planPerformance(1e6, 0, { ...DEFAULT_PERFORMANCE_PREFS, mode: "performance" }).tier).toBe("huge");
	});

	it("reduces detail as graphs grow", () => {
		const small = planPerformance(100, 100, DEFAULT_PERFORMANCE_PREFS);
		const huge = planPerformance(50000, 100000, DEFAULT_PERFORMANCE_PREFS);
		expect(huge.labelBudget).toBeLessThan(small.labelBudget);
		expect(huge.nodeResolution).toBeLessThan(small.nodeResolution);
		expect(huge.allowParticles).toBe(false);
	});
});
