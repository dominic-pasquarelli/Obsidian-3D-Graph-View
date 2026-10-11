import { rgbIntToHex } from "../util/color";
import type { ColorGroup } from "./colorGroups";

/**
 * Tolerant reader for Obsidian's core graph settings (`<configDir>/graph.json`).
 * Missing / malformed fields fall back to Obsidian's own defaults.
 */
export interface CoreGraphConfig {
	colorGroups: ColorGroup[];
	search: string;
	showTags: boolean;
	showAttachments: boolean;
	hideUnresolved: boolean;
	showOrphans: boolean;
	showArrow: boolean;
	centerStrength: number;
	repelStrength: number;
	linkStrength: number;
	linkDistance: number;
	nodeSizeMultiplier: number;
	lineSizeMultiplier: number;
	textFadeMultiplier: number;
}

export const CORE_GRAPH_DEFAULTS: CoreGraphConfig = {
	colorGroups: [],
	search: "",
	showTags: false,
	showAttachments: false,
	hideUnresolved: false,
	showOrphans: true,
	showArrow: false,
	centerStrength: 0.518713248970312,
	repelStrength: 10,
	linkStrength: 1,
	linkDistance: 250,
	nodeSizeMultiplier: 1,
	lineSizeMultiplier: 1,
	textFadeMultiplier: 0,
};

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

export function parseCoreGraphConfig(raw: unknown): CoreGraphConfig {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const d = CORE_GRAPH_DEFAULTS;
	const groups: ColorGroup[] = [];
	if (Array.isArray(r.colorGroups)) {
		for (const g of r.colorGroups) {
			if (!g || typeof g !== "object") continue;
			const gr = g as Record<string, unknown>;
			if (typeof gr.query !== "string") continue;
			const color = gr.color as Record<string, unknown> | undefined;
			const rgb = color && typeof color.rgb === "number" ? color.rgb : 0x888888;
			groups.push({ query: gr.query, color: rgbIntToHex(rgb), enabled: true });
		}
	}
	return {
		colorGroups: groups,
		search: typeof r.search === "string" ? r.search : d.search,
		showTags: bool(r.showTags, d.showTags),
		showAttachments: bool(r.showAttachments, d.showAttachments),
		hideUnresolved: bool(r.hideUnresolved, d.hideUnresolved),
		showOrphans: bool(r.showOrphans, d.showOrphans),
		showArrow: bool(r.showArrow, d.showArrow),
		centerStrength: num(r.centerStrength, d.centerStrength),
		repelStrength: num(r.repelStrength, d.repelStrength),
		linkStrength: num(r.linkStrength, d.linkStrength),
		linkDistance: num(r.linkDistance, d.linkDistance),
		nodeSizeMultiplier: num(r.nodeSizeMultiplier, d.nodeSizeMultiplier),
		lineSizeMultiplier: num(r.lineSizeMultiplier, d.lineSizeMultiplier),
		textFadeMultiplier: num(r.textFadeMultiplier, d.textFadeMultiplier),
	};
}
