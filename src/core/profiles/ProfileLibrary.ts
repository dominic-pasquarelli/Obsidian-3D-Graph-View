import { clone, isPlainObject, makeId } from "../util/object";

export type ProfileKind = "force" | "view";

export interface Profile<T> {
	id: string;
	name: string;
	settings: T;
	updatedAt: number;
	/** Key of the built-in this profile was seeded from (used by "restore defaults"). */
	builtIn?: string;
}

export interface ProfileFile<T = unknown> {
	type: "3d-graph-view-profile";
	kind: ProfileKind;
	version: 1;
	name: string;
	settings: T;
}

export interface BuiltInProfile<T> {
	key: string;
	name: string;
	settings: T;
}

/**
 * A named collection of settings snapshots. Used for force profiles and view
 * profiles alike — the kind only changes the normaliser and the built-ins.
 */
export class ProfileLibrary<T> {
	private items: Profile<T>[] = [];

	constructor(
		readonly kind: ProfileKind,
		private readonly normalize: (raw: unknown) => T,
		private readonly builtIns: () => BuiltInProfile<T>[],
	) {}

	/** Loads saved profiles, normalising each; seeds built-ins when nothing valid is saved. */
	load(raw: unknown): void {
		this.items = [];
		if (Array.isArray(raw)) {
			for (const entry of raw) {
				if (!isPlainObject(entry) || typeof entry.name !== "string") continue;
				this.items.push({
					id: typeof entry.id === "string" && entry.id ? entry.id : makeId(this.kind),
					name: entry.name,
					settings: this.normalize(entry.settings),
					updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
					builtIn: typeof entry.builtIn === "string" ? entry.builtIn : undefined,
				});
			}
		}
		if (this.items.length === 0) this.restoreBuiltIns();
	}

	toJSON(): Profile<T>[] {
		return clone(this.items);
	}

	list(): readonly Profile<T>[] {
		return this.items;
	}

	get(id: string | null | undefined): Profile<T> | undefined {
		return this.items.find((p) => p.id === id);
	}

	/** The profile with this id, or the first one. */
	resolve(id: string | null | undefined): Profile<T> {
		return this.get(id) ?? this.items[0];
	}

	uniqueName(base: string): string {
		const names = new Set(this.items.map((p) => p.name));
		if (!names.has(base)) return base;
		for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
	}

	create(name: string, settings: T): Profile<T> {
		const profile: Profile<T> = {
			id: makeId(this.kind),
			name: this.uniqueName(name.trim() || "Untitled"),
			settings: this.normalize(clone(settings)),
			updatedAt: Date.now(),
		};
		this.items.push(profile);
		return profile;
	}

	save(id: string, settings: T): Profile<T> | undefined {
		const profile = this.get(id);
		if (!profile) return undefined;
		profile.settings = this.normalize(clone(settings));
		profile.updatedAt = Date.now();
		return profile;
	}

	rename(id: string, name: string): boolean {
		const profile = this.get(id);
		const trimmed = name.trim();
		if (!profile || !trimmed) return false;
		if (trimmed !== profile.name) profile.name = this.uniqueName(trimmed);
		return true;
	}

	duplicate(id: string): Profile<T> | undefined {
		const profile = this.get(id);
		return profile ? this.create(`${profile.name} copy`, profile.settings) : undefined;
	}

	/** Deletes a profile; the last remaining profile cannot be deleted. */
	remove(id: string): boolean {
		if (this.items.length <= 1) return false;
		const before = this.items.length;
		this.items = this.items.filter((p) => p.id !== id);
		return this.items.length < before;
	}

	/** Re-adds missing built-ins and resets existing built-ins to their shipped values. */
	restoreBuiltIns(): void {
		for (const b of this.builtIns()) {
			const existing = this.items.find((p) => p.builtIn === b.key);
			if (existing) {
				existing.settings = this.normalize(clone(b.settings));
				existing.updatedAt = Date.now();
			} else {
				this.items.push({ id: `${this.kind}-${b.key}`, name: this.uniqueName(b.name), settings: this.normalize(clone(b.settings)), updatedAt: Date.now(), builtIn: b.key });
			}
		}
	}

	exportProfile(id: string): string | undefined {
		const profile = this.get(id);
		if (!profile) return undefined;
		const file: ProfileFile<T> = { type: "3d-graph-view-profile", kind: this.kind, version: 1, name: profile.name, settings: profile.settings };
		return JSON.stringify(file, null, 2);
	}

	/** Parses an exported profile and adds it. Throws with a readable message when invalid. */
	importProfile(json: string): Profile<T> {
		let data: unknown;
		try {
			data = JSON.parse(json);
		} catch {
			throw new Error("This file is not valid JSON.");
		}
		if (!isPlainObject(data) || data.type !== "3d-graph-view-profile") throw new Error("This file is not a 3D Graph View profile.");
		if (data.kind !== this.kind) throw new Error(`This is a ${String(data.kind)} profile, not a ${this.kind} profile.`);
		const name = typeof data.name === "string" ? data.name : "Imported";
		return this.create(name, this.normalize(data.settings));
	}
}
