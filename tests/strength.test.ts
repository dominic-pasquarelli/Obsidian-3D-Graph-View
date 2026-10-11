import { describe, expect, it } from "vitest";
import { combineCounts, referenceMultiplier, scaleCount } from "../src/core/graph/strength";

describe("strength scaling", () => {
	it("maps one reference to 1 in every mode", () => {
		for (const mode of ["off", "linear", "sqrt", "log"] as const) expect(scaleCount(1, mode)).toBe(1);
	});

	it("grows with references at different rates", () => {
		expect(scaleCount(4, "linear")).toBe(4);
		expect(scaleCount(4, "sqrt")).toBe(2);
		expect(scaleCount(4, "log")).toBe(3);
		expect(scaleCount(4, "off")).toBe(1);
	});

	it("respects influence and the cap", () => {
		expect(referenceMultiplier(4, "linear", 0, 10)).toBe(1);
		expect(referenceMultiplier(4, "linear", 0.5, 10)).toBe(2.5);
		expect(referenceMultiplier(100, "linear", 1, 4)).toBe(4);
	});

	it("combines directions", () => {
		expect(combineCounts(3, 1, "sum")).toBe(4);
		expect(combineCounts(3, 1, "max")).toBe(3);
	});
});
