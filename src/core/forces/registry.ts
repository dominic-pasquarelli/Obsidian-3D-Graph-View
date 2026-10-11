import { clone, isPlainObject, mergeWithDefaults } from "../util/object";
import { centerForceModule } from "./modules/center";
import { chargeForceModule } from "./modules/charge";
import { groupGravityModule } from "./modules/groups";
import { indirectForceModule } from "./modules/indirect";
import { linkForceModule } from "./modules/links";
import { simulationModule } from "./modules/simulation";
import type { ForceModule } from "./types";

/**
 * Ordered list of force modules. Order matters only for the panel layout.
 * Add new modules here — nothing else needs to change.
 */
export const FORCE_MODULES: ForceModule[] = [
	linkForceModule,
	indirectForceModule,
	chargeForceModule,
	centerForceModule,
	groupGravityModule,
	simulationModule,
];

/** Saved settings: module id → that module's settings object. */
export type ForceSettings = Record<string, Record<string, unknown>>;

export function getForceModule(id: string): ForceModule | undefined {
	return FORCE_MODULES.find((m) => m.id === id);
}

export function defaultForceSettings(): ForceSettings {
	const out: ForceSettings = {};
	for (const m of FORCE_MODULES) out[m.id] = clone(m.defaults);
	return out;
}

/** Fills in defaults for missing modules / keys and drops unknown ones. */
export function normalizeForceSettings(raw: unknown): ForceSettings {
	const source = isPlainObject(raw) ? raw : {};
	const out: ForceSettings = {};
	for (const m of FORCE_MODULES) out[m.id] = mergeWithDefaults(m.defaults, source[m.id]) as Record<string, unknown>;
	return out;
}
