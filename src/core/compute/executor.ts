import { TASKS, transferablesOf, type TaskInput, type TaskName, type TaskOutput } from "./tasks";

/** Runs registered compute tasks somewhere (main thread, worker, …). */
export interface ComputeExecutor {
	readonly kind: "main" | "worker";
	run<K extends TaskName>(task: K, input: TaskInput<K>): Promise<TaskOutput<K>>;
	dispose(): void;
}

export class MainThreadExecutor implements ComputeExecutor {
	readonly kind = "main" as const;

	run<K extends TaskName>(task: K, input: TaskInput<K>): Promise<TaskOutput<K>> {
		return new Promise((resolve, reject) => {
			// Yield first so UI updates (e.g. "computing…") can paint.
			setTimeout(() => {
				try {
					resolve(TASKS[task](input));
				} catch (err) {
					reject(err);
				}
			}, 0);
		});
	}

	dispose(): void {}
}

interface Pending {
	resolve: (value: never) => void;
	reject: (err: Error) => void;
}

/** Spawns the bundled compute worker from source text via a Blob URL. */
export class WorkerExecutor implements ComputeExecutor {
	readonly kind = "worker" as const;
	private worker: Worker | null = null;
	private url: string | null = null;
	private nextId = 1;
	private pending = new Map<number, Pending>();

	constructor(private readonly source: string) {}

	private ensureWorker(): Worker {
		if (this.worker) return this.worker;
		this.url = URL.createObjectURL(new Blob([this.source], { type: "text/javascript" }));
		const worker = new Worker(this.url);
		worker.onmessage = (e: MessageEvent) => {
			const { id, ok, output, error } = e.data as { id: number; ok: boolean; output?: unknown; error?: string };
			const p = this.pending.get(id);
			if (!p) return;
			this.pending.delete(id);
			if (ok) p.resolve(output as never);
			else p.reject(new Error(error ?? "Worker task failed"));
		};
		worker.onerror = (e) => {
			const err = new Error(e.message || "Worker error");
			for (const p of this.pending.values()) p.reject(err);
			this.pending.clear();
		};
		this.worker = worker;
		return worker;
	}

	run<K extends TaskName>(task: K, input: TaskInput<K>): Promise<TaskOutput<K>> {
		const worker = this.ensureWorker();
		const id = this.nextId++;
		return new Promise<TaskOutput<K>>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
			worker.postMessage({ id, task, input }, transferablesOf(input));
		});
	}

	dispose(): void {
		for (const p of this.pending.values()) p.reject(new Error("Executor disposed"));
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}
}

/**
 * Picks main thread or worker per call. Falls back to the main thread if the
 * worker cannot be created (e.g. a restrictive environment).
 */
export class AdaptiveExecutor {
	private main = new MainThreadExecutor();
	private worker: WorkerExecutor | null = null;
	private workerBroken = false;

	constructor(private readonly workerSource: string | null) {}

	pick(useWorker: boolean): ComputeExecutor {
		if (!useWorker || !this.workerSource || this.workerBroken) return this.main;
		if (!this.worker) this.worker = new WorkerExecutor(this.workerSource);
		return this.worker;
	}

	async run<K extends TaskName>(task: K, input: TaskInput<K>, useWorker: boolean): Promise<{ output: TaskOutput<K>; ranOn: "main" | "worker" }> {
		const executor = this.pick(useWorker);
		if (executor.kind === "main") return { output: await executor.run(task, input), ranOn: "main" };
		try {
			return { output: await executor.run(task, input), ranOn: "worker" };
		} catch (err) {
			if (err instanceof Error && err.message === "Executor disposed") throw err;
			console.warn("[3d-graph-view] worker failed, falling back to main thread", err);
			this.workerBroken = true;
			this.worker?.dispose();
			this.worker = null;
			return { output: await this.main.run(task, input), ranOn: "main" };
		}
	}

	dispose(): void {
		this.worker?.dispose();
		this.worker = null;
	}
}
