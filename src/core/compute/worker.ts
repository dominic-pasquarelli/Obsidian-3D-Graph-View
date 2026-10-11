import { SimulationRunner, type SimInit } from "../physics/SimulationRunner";
import { TASKS, transferablesOf, type TaskName } from "./tasks";

/**
 * Background worker, bundled separately and inlined into main.js as a string.
 * Speaks two protocols:
 *   - compute tasks:  { id, task, input }  →  { id, ok, output | error }
 *   - physics:        { kind: "sim:*", … }  →  { kind: "sim:positions", positions, done }
 */
interface WorkerScope {
	onmessage: ((e: MessageEvent) => void) | null;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}
const ctx = self as unknown as WorkerScope;

let runner: SimulationRunner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let firstStep = false;
/** Echoed back so the main thread can drop positions computed for a previous graph. */
let epoch = 0;

function loop(): void {
	timer = null;
	if (!runner) return;
	try {
		const { positions, done } = runner.step(firstStep ? 120 : 14);
		firstStep = false;
		ctx.postMessage({ kind: "sim:positions", epoch, positions, done }, [positions.buffer]);
		if (!done) timer = setTimeout(loop, 0);
	} catch (err) {
		ctx.postMessage({ kind: "sim:error", epoch, error: err instanceof Error ? err.message : String(err) });
	}
}

function kick(): void {
	if (timer === null) timer = setTimeout(loop, 0);
}

function handleSim(data: { kind: string } & Record<string, unknown>): void {
	switch (data.kind) {
		case "sim:init":
			epoch = typeof data.epoch === "number" ? data.epoch : epoch + 1;
			runner = new SimulationRunner();
			runner.init(data.init as SimInit);
			firstStep = true;
			kick();
			break;
		case "sim:settings":
			runner?.applySettings(data.settings as never, data.plan as never);
			if (Array.isArray(data.groups)) runner?.setGroups(data.groups as number[]);
			kick();
			break;
		case "sim:fix":
			runner?.fix(data.index as number, (data.pos as { x: number; y: number; z?: number } | null) ?? null, data.dragging === true);
			kick();
			break;
		case "sim:reheat":
			runner?.reheat();
			kick();
			break;
		case "sim:stop":
			runner = null;
			if (timer !== null) clearTimeout(timer);
			timer = null;
			break;
	}
}

ctx.onmessage = (e: MessageEvent) => {
	const data = e.data as { kind?: string };
	if (typeof data.kind === "string" && data.kind.startsWith("sim:")) {
		try {
			handleSim(data as { kind: string } & Record<string, unknown>);
		} catch (err) {
			ctx.postMessage({ kind: "sim:error", epoch, error: err instanceof Error ? err.message : String(err) });
		}
		return;
	}
	const { id, task, input } = e.data as { id: number; task: TaskName; input: never };
	try {
		const fn = TASKS[task] as ((i: unknown) => unknown) | undefined;
		if (!fn) throw new Error(`Unknown task: ${String(task)}`);
		const output = fn(input);
		ctx.postMessage({ id, ok: true, output }, transferablesOf(output));
	} catch (err) {
		ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
	}
};
