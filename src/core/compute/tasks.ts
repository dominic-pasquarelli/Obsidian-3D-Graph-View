import { computeIndirect, type IndirectInput, type IndirectOutput } from "../graph/indirect";

/**
 * Registry of heavy, pure computations that may run on the main thread or in
 * the compute worker. To add a task: implement a pure function, add it here,
 * and list any typed arrays to transfer in `transferablesOf`.
 */
export interface TaskMap {
	indirect: { input: IndirectInput; output: IndirectOutput };
}

export type TaskName = keyof TaskMap;
export type TaskInput<K extends TaskName> = TaskMap[K]["input"];
export type TaskOutput<K extends TaskName> = TaskMap[K]["output"];

export const TASKS: { [K in TaskName]: (input: TaskInput<K>) => TaskOutput<K> } = {
	indirect: computeIndirect,
};

/** Typed-array buffers inside a task payload, so postMessage can move rather than copy them. */
export function transferablesOf(value: unknown): Transferable[] {
	const out: Transferable[] = [];
	const seen = new Set<ArrayBufferLike>();
	const visit = (v: unknown, depth: number) => {
		if (depth > 3 || v === null || typeof v !== "object") return;
		if (ArrayBuffer.isView(v)) {
			const buf = v.buffer;
			if (buf instanceof ArrayBuffer && !seen.has(buf)) {
				seen.add(buf);
				out.push(buf);
			}
			return;
		}
		for (const child of Object.values(v as Record<string, unknown>)) visit(child, depth + 1);
	};
	visit(value, 0);
	return out;
}
