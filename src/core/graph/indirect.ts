/**
 * Second / third-level link gravity.
 *
 * Counts how many distinct 2-step (A→X→D) and 3-step (A→X→Y→D) paths connect
 * each pair of nodes. Pairs that are reached "often" (≥ minPaths) get an
 * indirect link whose pull grows with that count.
 *
 * Pure function over typed arrays so it can run on the main thread or inside a
 * Web Worker unchanged. Work is bounded by a hub cap (very connected nodes are
 * not walked through) and an optional per-source work budget.
 */

export interface IndirectLevelOptions {
	enabled: boolean;
	/** Minimum number of paths before a pair counts as "showing up often". */
	minPaths: number;
	/** Relative importance when ranking candidates (does not affect the counts). */
	weight: number;
}

export interface IndirectOptions {
	/** true: only follow links forward (A→X→D). false: ignore direction (also catches A→X←D). */
	directed: boolean;
	level2: IndirectLevelOptions;
	level3: IndirectLevelOptions;
	/** Nodes with more distinct neighbours than this are not walked through. 0 = no cap. */
	maxHubDegree: number;
	/** Keep at most this many indirect partners per source node. 0 = no cap. */
	maxPerNode: number;
	/** Keep at most this many indirect links overall. 0 = no cap. */
	maxTotal: number;
	/** Skip pairs that are already directly linked. */
	skipDirect: boolean;
	/** Max path-steps explored per source before giving up on its level-3 walk. 0 = unlimited. */
	workBudgetPerNode: number;
}

export interface IndirectInput {
	nodeCount: number;
	/** Directed edge list (deduplicated or not — duplicates are ignored). */
	src: Int32Array;
	dst: Int32Array;
	options: IndirectOptions;
}

export interface IndirectOutput {
	/** Pair endpoints (a < b). */
	a: Int32Array;
	b: Int32Array;
	/** Qualifying path counts (0 when that level did not qualify). */
	level2: Float64Array;
	level3: Float64Array;
	/** Sources whose level-3 walk hit the work budget. */
	truncatedSources: number;
	/** Total path-steps explored. */
	work: number;
}

interface Csr {
	offsets: Int32Array;
	targets: Int32Array;
}

/** Builds a deduplicated compressed-sparse-row adjacency (self-loops removed). */
export function buildCsr(nodeCount: number, src: Int32Array, dst: Int32Array, symmetric: boolean): Csr {
	const m = src.length;
	const counts = new Int32Array(nodeCount + 1);
	for (let i = 0; i < m; i++) {
		if (src[i] === dst[i]) continue;
		counts[src[i]]++;
		if (symmetric) counts[dst[i]]++;
	}
	const offsets = new Int32Array(nodeCount + 1);
	for (let i = 0; i < nodeCount; i++) offsets[i + 1] = offsets[i] + counts[i];
	const fill = offsets.slice(0, nodeCount);
	const raw = new Int32Array(offsets[nodeCount]);
	for (let i = 0; i < m; i++) {
		const s = src[i];
		const d = dst[i];
		if (s === d) continue;
		raw[fill[s]++] = d;
		if (symmetric) raw[fill[d]++] = s;
	}
	// Deduplicate each row with a stamp array.
	const stamp = new Int32Array(nodeCount).fill(-1);
	const outOffsets = new Int32Array(nodeCount + 1);
	const out = new Int32Array(raw.length);
	let w = 0;
	for (let v = 0; v < nodeCount; v++) {
		outOffsets[v] = w;
		for (let k = offsets[v]; k < offsets[v + 1]; k++) {
			const t = raw[k];
			if (stamp[t] === v) continue;
			stamp[t] = v;
			out[w++] = t;
		}
	}
	outOffsets[nodeCount] = w;
	return { offsets: outOffsets, targets: out.slice(0, w) };
}

interface Candidate {
	d: number;
	c2: number;
	c3: number;
	score: number;
}

export function computeIndirect(input: IndirectInput): IndirectOutput {
	const { nodeCount: n, src, dst, options } = input;
	const empty: IndirectOutput = {
		a: new Int32Array(0),
		b: new Int32Array(0),
		level2: new Float64Array(0),
		level3: new Float64Array(0),
		truncatedSources: 0,
		work: 0,
	};
	const use2 = options.level2.enabled;
	const use3 = options.level3.enabled;
	if (n === 0 || src.length === 0 || (!use2 && !use3)) return empty;

	const walk = buildCsr(n, src, dst, !options.directed);
	const undirected = options.directed ? buildCsr(n, src, dst, true) : walk;
	const degree = (v: number) => undirected.offsets[v + 1] - undirected.offsets[v];
	const hubCap = options.maxHubDegree > 0 ? options.maxHubDegree : Infinity;
	const budget = options.workBudgetPerNode > 0 ? options.workBudgetPerNode : Infinity;
	const min2 = Math.max(1, options.level2.minPaths);
	const min3 = Math.max(1, options.level3.minPaths);
	const w2 = options.level2.weight;
	const w3 = options.level3.weight;

	const acc2 = new Float64Array(n);
	const acc3 = new Float64Array(n);
	const directMark = new Int32Array(n).fill(-1);
	const touched2: number[] = [];
	const touched3: number[] = [];

	// A pair can be found from both ends. Directed: the two directions add up.
	// Undirected: both ends see the same paths, so the pair is kept once.
	const pairIndex = new Map<number, number>();
	const outA: number[] = [];
	const outB: number[] = [];
	const out2: number[] = [];
	const out3: number[] = [];
	let truncatedSources = 0;
	let totalWork = 0;

	const { offsets: wo, targets: wt } = walk;

	for (let s = 0; s < n; s++) {
		if (wo[s + 1] === wo[s]) continue;
		for (let k = undirected.offsets[s]; k < undirected.offsets[s + 1]; k++) directMark[undirected.targets[k]] = s;

		let work = 0;
		// Level 2: s → x → d
		for (let i = wo[s]; i < wo[s + 1]; i++) {
			const x = wt[i];
			if (degree(x) > hubCap) continue;
			for (let j = wo[x]; j < wo[x + 1]; j++) {
				const d = wt[j];
				if (d === s) continue;
				if (acc2[d] === 0) touched2.push(d);
				acc2[d] += 1;
				work++;
			}
		}
		// Level 3: s → x → y → d  (expand from every level-2 endpoint y, weighted by its path count)
		if (use3) {
			let truncated = false;
			outer: for (let t = 0; t < touched2.length; t++) {
				const y = touched2[t];
				if (degree(y) > hubCap) continue;
				const paths = acc2[y];
				for (let j = wo[y]; j < wo[y + 1]; j++) {
					const d = wt[j];
					if (d === s) continue;
					if (acc3[d] === 0) touched3.push(d);
					acc3[d] += paths;
					if (++work > budget) {
						truncated = true;
						break outer;
					}
				}
			}
			if (truncated) truncatedSources++;
		}
		totalWork += work;

		// Collect qualifying candidates for this source.
		const candidates: Candidate[] = [];
		const consider = (d: number) => {
			if (acc2[d] < 0) return; // already considered via the other list
			const c2raw = acc2[d];
			const c3raw = acc3[d];
			acc2[d] = -1; // mark considered (reset below)
			if (options.skipDirect && directMark[d] === s) return;
			const c2 = use2 && c2raw >= min2 ? c2raw : 0;
			const c3 = use3 && c3raw >= min3 ? c3raw : 0;
			if (c2 === 0 && c3 === 0) return;
			candidates.push({ d, c2, c3, score: w2 * c2 + w3 * c3 });
		};
		for (const d of touched2) consider(d);
		for (const d of touched3) consider(d);
		for (const d of touched2) acc2[d] = 0;
		for (const d of touched3) {
			acc2[d] = 0;
			acc3[d] = 0;
		}
		touched2.length = 0;
		touched3.length = 0;

		if (options.maxPerNode > 0 && candidates.length > options.maxPerNode) {
			candidates.sort((p, q) => q.score - p.score || p.d - q.d);
			candidates.length = options.maxPerNode;
		}
		for (const c of candidates) {
			const a = Math.min(s, c.d);
			const b = Math.max(s, c.d);
			const key = a * n + b;
			const existing = pairIndex.get(key);
			if (existing !== undefined) {
				if (options.directed) {
					out2[existing] += c.c2;
					out3[existing] += c.c3;
				} else {
					out2[existing] = Math.max(out2[existing], c.c2);
					out3[existing] = Math.max(out3[existing], c.c3);
				}
				continue;
			}
			pairIndex.set(key, outA.length);
			outA.push(a);
			outB.push(b);
			out2.push(c.c2);
			out3.push(c.c3);
		}
	}

	let order = outA.map((_, i) => i);
	if (options.maxTotal > 0 && order.length > options.maxTotal) {
		order.sort((i, j) => w2 * out2[j] + w3 * out3[j] - (w2 * out2[i] + w3 * out3[i]) || i - j);
		order = order.slice(0, options.maxTotal);
	}
	return {
		a: Int32Array.from(order, (i) => outA[i]),
		b: Int32Array.from(order, (i) => outB[i]),
		level2: Float64Array.from(order, (i) => out2[i]),
		level3: Float64Array.from(order, (i) => out3[i]),
		truncatedSources,
		work: totalWork,
	};
}
