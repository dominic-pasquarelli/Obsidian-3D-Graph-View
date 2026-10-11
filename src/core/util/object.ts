/** Small, dependency-free object helpers shared by profiles, settings and modules. */

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structured clone that works in Node, browsers and workers for plain JSON data. */
export function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Overlays `partial` on top of `defaults`, keeping only keys known to `defaults`
 * and only values whose type matches the default. This is what lets old saved
 * profiles keep working when new settings are added in later versions.
 * Arrays are taken from `partial` as-is (their item shape is validated by callers).
 */
export function mergeWithDefaults<T>(defaults: T, partial: unknown): T {
	if (!isPlainObject(defaults)) {
		if (Array.isArray(defaults)) return (Array.isArray(partial) ? clone(partial) : clone(defaults)) as T;
		return (partial !== undefined && typeof partial === typeof defaults ? partial : defaults) as T;
	}
	const source = isPlainObject(partial) ? partial : {};
	const out: Record<string, unknown> = {};
	for (const [key, def] of Object.entries(defaults)) {
		out[key] = mergeWithDefaults(def, source[key]);
	}
	return out as T;
}

/** Reads a dotted path such as "links.width" from an object. */
export function getPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const part of path.split(".")) {
		if (!isPlainObject(cur)) return undefined;
		cur = cur[part];
	}
	return cur;
}

/** Writes a dotted path, creating intermediate objects as needed. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let cur: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = cur[parts[i]];
		if (!isPlainObject(next)) cur[parts[i]] = {};
		cur = cur[parts[i]] as Record<string, unknown>;
	}
	cur[parts[parts.length - 1]] = value;
}

/** Stable JSON used for cheap "did these settings change?" checks. */
export function stableKey(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	if (isPlainObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableKey(value[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

let idCounter = 0;
export function makeId(prefix = "id"): string {
	idCounter = (idCounter + 1) % 1e6;
	return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
