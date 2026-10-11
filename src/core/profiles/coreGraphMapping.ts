import type { CoreGraphConfig } from "../color/coreGraph";
import type { ForceSettings } from "../forces/registry";
import type { ViewSettings } from "../settings/view";
import { clone } from "../util/object";

/**
 * Maps Obsidian's core graph settings onto this plugin's settings so a user can
 * start from what they already tuned. The physics don't map 1:1 (different
 * engines), so values are scaled into comparable ranges.
 */
export function applyCoreGraphToView(view: ViewSettings, core: CoreGraphConfig, includeColors = true): ViewSettings {
	const out = clone(view);
	out.filters = {
		search: core.search,
		showTags: core.showTags,
		showAttachments: core.showAttachments,
		showUnresolved: !core.hideUnresolved,
		showOrphans: core.showOrphans,
	};
	if (includeColors) out.colors.groups = clone(core.colorGroups);
	out.links.arrows = core.showArrow;
	out.nodes.size = Math.max(1, Math.min(12, 4 * core.nodeSizeMultiplier));
	out.links.width = Math.max(0, Math.min(5, 0.6 * core.lineSizeMultiplier));
	return out;
}

export function applyCoreGraphToForces(forces: ForceSettings, core: CoreGraphConfig): ForceSettings {
	const out = clone(forces);
	// Core: linkDistance 30–500 (default 250), repel 0–20 (default 10), link 0–1, center 0–1.
	out.links = { ...out.links, distance: Math.round(Math.max(5, Math.min(300, core.linkDistance * 0.18))), strength: Math.max(0, Math.min(1.5, core.linkStrength * 0.5)) };
	out.charge = { ...out.charge, repel: Math.round(Math.max(0, Math.min(500, core.repelStrength * 6))) };
	out.center = { ...out.center, gravity: Math.max(0, Math.min(0.5, core.centerStrength * 0.08)) };
	return out;
}
