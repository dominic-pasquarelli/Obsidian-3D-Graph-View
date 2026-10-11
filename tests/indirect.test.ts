import { describe, expect, it } from "vitest";
import { buildCsr, computeIndirect, type IndirectOptions } from "../src/core/graph/indirect";

const base: IndirectOptions = {
	directed: true,
	level2: { enabled: true, minPaths: 1, weight: 1 },
	level3: { enabled: false, minPaths: 1, weight: 0.35 },
	maxHubDegree: 0,
	maxPerNode: 0,
	maxTotal: 0,
	skipDirect: true,
	workBudgetPerNode: 0,
};

function run(n: number, edges: [number, number][], options: Partial<IndirectOptions> = {}) {
	const out = computeIndirect({
		nodeCount: n,
		src: Int32Array.from(edges.map((e) => e[0])),
		dst: Int32Array.from(edges.map((e) => e[1])),
		options: { ...base, ...options },
	});
	const pairs = new Map<string, { l2: number; l3: number }>();
	for (let i = 0; i < out.a.length; i++) pairs.set(`${out.a[i]}-${out.b[i]}`, { l2: out.level2[i], l3: out.level3[i] });
	return { out, pairs };
}

describe("buildCsr", () => {
	it("deduplicates and drops self loops", () => {
		const csr = buildCsr(3, Int32Array.from([0, 0, 0, 1]), Int32Array.from([1, 1, 0, 2]), false);
		expect(Array.from(csr.targets.slice(csr.offsets[0], csr.offsets[1]))).toEqual([1]);
		expect(Array.from(csr.targets.slice(csr.offsets[1], csr.offsets[2]))).toEqual([2]);
	});
});

describe("computeIndirect", () => {
	// 0 → 1 → 3, 0 → 2 → 3  : node 3 appears twice as a 2nd-level link of 0
	const diamond: [number, number][] = [
		[0, 1],
		[0, 2],
		[1, 3],
		[2, 3],
	];

	it("counts 2-step paths (directed)", () => {
		const { pairs } = run(4, diamond);
		expect(pairs.get("0-3")).toEqual({ l2: 2, l3: 0 });
		// 1 and 2 are not reachable from each other following direction
		expect(pairs.has("1-2")).toBe(false);
	});

	it("applies the minimum path threshold", () => {
		const { pairs } = run(4, diamond, { level2: { enabled: true, minPaths: 3, weight: 1 } });
		expect(pairs.size).toBe(0);
	});

	it("undirected mode also links notes that share neighbours", () => {
		const { pairs } = run(4, diamond, { directed: false });
		// 1 and 2 share neighbours 0 and 3
		expect(pairs.get("1-2")).toEqual({ l2: 2, l3: 0 });
		expect(pairs.get("0-3")).toEqual({ l2: 2, l3: 0 });
	});

	it("counts 3-step paths weighted by multiplicity", () => {
		// 0→1→3→4 and 0→2→3→4 : two 3-step paths 0⇒4
		const { pairs } = run(5, [...diamond, [3, 4]], { level3: { enabled: true, minPaths: 2, weight: 0.35 } });
		expect(pairs.get("0-4")?.l3).toBe(2);
	});

	it("skips directly linked pairs unless told otherwise", () => {
		const edges: [number, number][] = [...diamond, [0, 3]];
		expect(run(4, edges).pairs.has("0-3")).toBe(false);
		expect(run(4, edges, { skipDirect: false }).pairs.get("0-3")?.l2).toBe(2);
	});

	it("does not walk through hubs above the cap", () => {
		// 0 → hub(1) → 2..6 ; hub has degree 6
		const edges: [number, number][] = [[0, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6]];
		expect(run(7, edges).pairs.size).toBeGreaterThan(0);
		expect(run(7, edges, { maxHubDegree: 3 }).pairs.size).toBe(0);
	});

	it("keeps only the strongest partners per node", () => {
		// 0 reaches 5 via 3 paths, 6 via 1 path
		const edges: [number, number][] = [[0, 1], [0, 2], [0, 3], [1, 5], [2, 5], [3, 5], [1, 6]];
		const { pairs } = run(7, edges, { maxPerNode: 1 });
		expect(pairs.get("0-5")?.l2).toBe(3);
		expect(pairs.has("0-6")).toBe(false);
	});

	it("sums both directions in directed mode", () => {
		// 0→1→2 and 2→3→0
		const { pairs } = run(4, [[0, 1], [1, 2], [2, 3], [3, 0]]);
		expect(pairs.get("0-2")?.l2).toBe(2);
	});

	it("respects the global cap and the work budget", () => {
		const { out } = run(4, diamond, { directed: false, maxTotal: 1 });
		expect(out.a.length).toBe(1);
		const budget = run(5, [...diamond, [3, 4]], { level3: { enabled: true, minPaths: 1, weight: 1 }, workBudgetPerNode: 1 });
		expect(budget.out.truncatedSources).toBeGreaterThan(0);
	});

	it("handles empty graphs", () => {
		expect(run(0, []).out.a.length).toBe(0);
		expect(run(3, [], {}).out.a.length).toBe(0);
	});

	it("scales to a 20k-node random graph quickly", () => {
		const n = 20000;
		const edges: [number, number][] = [];
		let seed = 1;
		const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		for (let i = 0; i < n * 4; i++) edges.push([Math.floor(rand() * n), Math.floor(rand() * n)]);
		const t = Date.now();
		const { out } = run(n, edges, { level3: { enabled: true, minPaths: 2, weight: 0.35 }, maxHubDegree: 80, maxPerNode: 12, workBudgetPerNode: 40000 });
		expect(Date.now() - t).toBeLessThan(5000);
		expect(out.a.length).toBeGreaterThan(0);
	});
});
