import { defaultForceSettings, type ForceSettings } from "../forces/registry";
import { clone, setPath } from "../util/object";
import { DEFAULT_VIEW_SETTINGS, type ViewSettings } from "../settings/view";
import type { BuiltInProfile } from "./ProfileLibrary";

function withOverrides<T extends object>(base: T, overrides: Record<string, unknown>): T {
	const copy = clone(base) as Record<string, unknown>;
	for (const [path, value] of Object.entries(overrides)) setPath(copy, path, value);
	return copy as T;
}

export function builtInForceProfiles(): BuiltInProfile<ForceSettings>[] {
	const base = defaultForceSettings();
	return [
		{ key: "balanced", name: "Balanced", settings: base },
		{
			key: "reference-clusters",
			name: "Reference clusters",
			settings: withOverrides(base, {
				"links.referenceScale": "linear",
				"links.referenceInfluence": 1.5,
				"links.maxMultiplier": 8,
				"links.distanceInfluence": 0.8,
				"charge.repel": 90,
			}),
		},
		{
			key: "neural",
			name: "Neural (indirect gravity)",
			settings: withOverrides(base, {
				"indirect.enabled": true,
				"indirect.level2.enabled": true,
				"indirect.level2.minPaths": 2,
				"indirect.level2.strength": 0.15,
				"indirect.level3.enabled": true,
				"indirect.level3.minPaths": 4,
				"indirect.level3.strength": 0.05,
				"groups.enabled": true,
				"groups.strength": 0.03,
				"charge.repel": 80,
			}),
		},
		{
			key: "classification",
			name: "Colour-group regions",
			settings: withOverrides(base, { "groups.enabled": true, "groups.strength": 0.12, "charge.repel": 70 }),
		},
	];
}

export function builtInViewProfiles(): BuiltInProfile<ViewSettings>[] {
	const base = DEFAULT_VIEW_SETTINGS;
	return [
		{ key: "default-3d", name: "Default", settings: clone(base) },
		{
			key: "neural-glow",
			name: "Neural glow",
			settings: withOverrides(base, {
				mode: "3d",
				"style.background": "space",
				"style.bloom": true,
				"links.particles": "all",
				"links.opacity": 0.25,
				"links.showIndirect": true,
				"links.indirectOpacity": 0.08,
				"nodes.opacity": 1,
			}),
		},
		{
			key: "recall",
			name: "Recall (labels on hover)",
			settings: withOverrides(base, {
				"labels.mode": "hover",
				"interaction.dimOpacity": 0.05,
				"links.particles": "hover",
			}),
		},
	];
}
