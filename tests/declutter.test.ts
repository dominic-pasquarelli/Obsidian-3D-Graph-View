import { describe, expect, it } from "vitest";
import { declutter } from "../src/renderers/declutter";

describe("declutter", () => {
	it("keeps the higher-priority label when two overlap", () => {
		const kept = declutter([
			{ id: "low", x: 100, y: 100, w: 80, h: 14, priority: 1 },
			{ id: "high", x: 110, y: 104, w: 80, h: 14, priority: 5 },
			{ id: "apart", x: 400, y: 100, w: 80, h: 14, priority: 0 },
		]);
		expect([...kept].sort()).toEqual(["apart", "high"]);
	});

	it("handles boxes spanning grid cells and many labels", () => {
		const boxes = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), x: (i % 50) * 30, y: Math.floor(i / 50) * 10, w: 60, h: 12, priority: i }));
		const kept = declutter(boxes);
		expect(kept.size).toBeGreaterThan(0);
		const keptBoxes = boxes.filter((b) => kept.has(b.id));
		for (const a of keptBoxes)
			for (const b of keptBoxes)
				if (a !== b) expect(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2).toBe(true);
	});
});
