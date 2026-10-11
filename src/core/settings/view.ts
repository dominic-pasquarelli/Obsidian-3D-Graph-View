import { normalizeColorGroup, type ColorGroup } from "../color/colorGroups";
import type { GraphFilters } from "../graph/types";
import { normalizeHex } from "../util/color";
import { isPlainObject, mergeWithDefaults } from "../util/object";
import type { ControlSection } from "./controls";

export type GraphMode = "3d" | "2d";
export type LabelMode = "auto" | "always" | "hover" | "never";
export type SizeBy = "degree" | "inRefs" | "uniform";
export type ParticleMode = "off" | "hover" | "all";
export type BackgroundMode = "theme" | "space" | "custom";
export type Controls3D = "orbit" | "trackball" | "fly";

export interface ColorSettings {
	/** Read colour groups live from the core graph instead of `groups`. */
	useCoreGroups: boolean;
	groups: ColorGroup[];
	note: string;
	unresolved: string;
	attachment: string;
	tag: string;
	/** Opacity of not-yet-created notes. */
	unresolvedOpacity: number;
}

export interface ViewSettings {
	mode: GraphMode;
	filters: GraphFilters;
	colors: ColorSettings;
	nodes: { sizeBy: SizeBy; size: number; sizeScale: number; opacity: number };
	links: {
		width: number;
		widthByRefs: boolean;
		opacity: number;
		arrows: boolean;
		showIndirect: boolean;
		indirectOpacity: number;
		particles: ParticleMode;
		particleSpeed: number;
	};
	labels: { mode: LabelMode; size: number; zoomThreshold: number };
	style: { background: BackgroundMode; customBackground: string; bloom: boolean; bloomStrength: number };
	interaction: { highlightOnHover: boolean; dimOpacity: number; highlightActive: boolean; pinOnDrag: boolean; controls3d: Controls3D };
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
	mode: "3d",
	filters: { showUnresolved: true, showAttachments: false, showTags: false, showOrphans: true, search: "" },
	colors: {
		useCoreGroups: true,
		groups: [],
		note: "#8a8fa3",
		unresolved: "#b0b0b0",
		attachment: "#d6a14a",
		tag: "#5fb3a1",
		unresolvedOpacity: 0.35,
	},
	nodes: { sizeBy: "degree", size: 4, sizeScale: 1, opacity: 0.92 },
	links: {
		width: 0.6,
		widthByRefs: true,
		opacity: 0.35,
		arrows: false,
		showIndirect: false,
		indirectOpacity: 0.12,
		particles: "hover",
		particleSpeed: 0.006,
	},
	labels: { mode: "auto", size: 1, zoomThreshold: 1.6 },
	style: { background: "theme", customBackground: "#0b0d17", bloom: false, bloomStrength: 1.1 },
	interaction: { highlightOnHover: true, dimOpacity: 0.12, highlightActive: true, pinOnDrag: false, controls3d: "orbit" },
};

export function normalizeViewSettings(raw: unknown): ViewSettings {
	const merged = mergeWithDefaults(DEFAULT_VIEW_SETTINGS, raw);
	merged.mode = merged.mode === "2d" ? "2d" : "3d";
	const rawGroups = isPlainObject(raw) && isPlainObject(raw.colors) ? raw.colors.groups : undefined;
	merged.colors.groups = Array.isArray(rawGroups) ? rawGroups.map(normalizeColorGroup).filter((g): g is ColorGroup => g !== null) : [];
	for (const key of ["note", "unresolved", "attachment", "tag"] as const) {
		merged.colors[key] = normalizeHex(merged.colors[key], DEFAULT_VIEW_SETTINGS.colors[key]);
	}
	merged.style.customBackground = normalizeHex(merged.style.customBackground, DEFAULT_VIEW_SETTINGS.style.customBackground);
	return merged;
}

/** Panel sections for display settings (colour groups have their own editor). */
export const VIEW_SECTIONS: ControlSection<ViewSettings>[] = [
	{
		id: "filters",
		label: "Filters",
		controls: [
			{ type: "text", key: "filters.search", label: "Search filter", placeholder: "e.g. path:Projects -tag:#archive" },
			{ type: "toggle", key: "filters.showUnresolved", label: "Show notes that don't exist yet" },
			{ type: "toggle", key: "filters.showAttachments", label: "Show attachments" },
			{ type: "toggle", key: "filters.showTags", label: "Show tags as nodes" },
			{ type: "toggle", key: "filters.showOrphans", label: "Show orphans" },
		],
	},
	{
		id: "nodes",
		label: "Nodes",
		controls: [
			{ type: "dropdown", key: "nodes.sizeBy", label: "Size by", options: { degree: "Connections", inRefs: "Times referenced", uniform: "Same size" } },
			{ type: "slider", key: "nodes.size", label: "Node size", min: 1, max: 12, step: 0.5 },
			{ type: "slider", key: "nodes.sizeScale", label: "Size growth", min: 0, max: 3, step: 0.1, showIf: (s) => s.nodes.sizeBy !== "uniform" },
			{ type: "slider", key: "nodes.opacity", label: "Opacity", min: 0.1, max: 1, step: 0.05 },
			{ type: "color", key: "colors.note", label: "Note colour" },
			{ type: "color", key: "colors.unresolved", label: "Not-yet-created colour" },
			{ type: "slider", key: "colors.unresolvedOpacity", label: "Not-yet-created opacity", min: 0.05, max: 1, step: 0.05 },
			{ type: "color", key: "colors.attachment", label: "Attachment colour" },
			{ type: "color", key: "colors.tag", label: "Tag colour" },
		],
	},
	{
		id: "links",
		label: "Links",
		controls: [
			{ type: "slider", key: "links.width", label: "Link width", min: 0, max: 5, step: 0.1 },
			{ type: "toggle", key: "links.widthByRefs", label: "Thicker for more references" },
			{ type: "slider", key: "links.opacity", label: "Link opacity", min: 0.02, max: 1, step: 0.02 },
			{ type: "toggle", key: "links.arrows", label: "Arrows" },
			{ type: "toggle", key: "links.showIndirect", label: "Show indirect links", desc: "Draw the 2nd/3rd-level gravity links." },
			{ type: "slider", key: "links.indirectOpacity", label: "Indirect link opacity", min: 0.02, max: 1, step: 0.02, showIf: (s) => s.links.showIndirect },
			{ type: "dropdown", key: "links.particles", label: "Signal particles", options: { off: "Off", hover: "On hover", all: "Always" } },
			{ type: "slider", key: "links.particleSpeed", label: "Particle speed", min: 0.001, max: 0.03, step: 0.001, showIf: (s) => s.links.particles !== "off" },
		],
	},
	{
		id: "labels",
		label: "Labels",
		controls: [
			{
				type: "dropdown",
				key: "labels.mode",
				label: "Show labels",
				options: { auto: "Automatic (important + zoom)", always: "Always", hover: "On hover", never: "Never" },
			},
			{ type: "slider", key: "labels.size", label: "Label size", min: 0.4, max: 3, step: 0.1 },
			{ type: "slider", key: "labels.zoomThreshold", label: "2D: zoom to reveal labels", min: 0.2, max: 6, step: 0.1, showIf: (s) => s.mode === "2d" },
		],
	},
	{
		id: "style",
		label: "Style",
		controls: [
			{ type: "dropdown", key: "style.background", label: "Background", options: { theme: "Match theme", space: "Deep space", custom: "Custom" } },
			{ type: "color", key: "style.customBackground", label: "Custom background", showIf: (s) => s.style.background === "custom" },
			{ type: "toggle", key: "style.bloom", label: "3D glow (bloom)", desc: "Neural-style glow. Turned off automatically on very large graphs.", showIf: (s) => s.mode === "3d" },
			{ type: "slider", key: "style.bloomStrength", label: "Glow strength", min: 0.1, max: 3, step: 0.1, showIf: (s) => s.mode === "3d" && s.style.bloom },
		],
	},
	{
		id: "interaction",
		label: "Interaction",
		controls: [
			{ type: "toggle", key: "interaction.highlightOnHover", label: "Highlight neighbours on hover" },
			{ type: "slider", key: "interaction.dimOpacity", label: "Dim others to", min: 0, max: 1, step: 0.02 },
			{ type: "toggle", key: "interaction.highlightActive", label: "Highlight the active note" },
			{ type: "toggle", key: "interaction.pinOnDrag", label: "Pin nodes after dragging" },
			{
				type: "dropdown",
				key: "interaction.controls3d",
				label: "3D camera controls",
				options: { orbit: "Orbit (stays upright)", trackball: "Trackball (free rotation)", fly: "Fly (WASD)" },
				showIf: (s) => s.mode === "3d",
			},
		],
	},
];
