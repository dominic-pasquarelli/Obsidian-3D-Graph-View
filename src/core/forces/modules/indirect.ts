import type { IndirectOptions } from "../../graph/indirect";
import { indirectInputFromModel, indirectLinksFromOutput } from "../../graph/indirectBridge";
import { scaleCount, SCALE_MODE_LABELS, type ScaleMode } from "../../graph/strength";
import { stableKey } from "../../util/object";
import type { ForceModule } from "../types";

export interface IndirectLevelSettings {
	enabled: boolean;
	minPaths: number;
	strength: number;
}

export interface IndirectForceSettings {
	enabled: boolean;
	/** Follow link direction (A→B→D) or ignore it (any connecting path). */
	directed: boolean;
	level2: IndirectLevelSettings;
	level3: IndirectLevelSettings;
	/** How path counts grow the pull. */
	countScale: ScaleMode;
	/** Rest length of indirect springs. */
	distance: number;
	skipDirect: boolean;
	includeTagLinks: boolean;
	/** 0 = automatic (from graph size). */
	maxHubDegree: number;
	/** Indirect partners kept per note (strongest first). 0 = unlimited. */
	maxPerNode: number;
	/** 0 = automatic (4 × node count, max 100k). */
	maxTotal: number;
}

/** Fixed ranking weights so strength sliders never trigger a recompute. */
const RANK_WEIGHT_L2 = 1;
const RANK_WEIGHT_L3 = 0.35;

export function indirectOptions(s: IndirectForceSettings, nodeCount: number, hubCap: number, workBudget: number): IndirectOptions {
	return {
		directed: s.directed,
		level2: { enabled: s.level2.enabled, minPaths: s.level2.minPaths, weight: RANK_WEIGHT_L2 },
		level3: { enabled: s.level3.enabled, minPaths: s.level3.minPaths, weight: RANK_WEIGHT_L3 },
		maxHubDegree: s.maxHubDegree > 0 ? s.maxHubDegree : hubCap,
		maxPerNode: s.maxPerNode,
		maxTotal: s.maxTotal > 0 ? s.maxTotal : Math.min(100000, nodeCount * 4),
		skipDirect: s.skipDirect,
		workBudgetPerNode: workBudget,
	};
}

export const indirectForceModule: ForceModule<IndirectForceSettings> = {
	id: "indirect",
	label: "Second & third-level gravity",
	description:
		"Notes reached through many 2- or 3-step paths pull towards each other, even without a direct link. Builds 'neural' clusters around recurring connections.",
	defaults: {
		enabled: false,
		directed: true,
		level2: { enabled: true, minPaths: 2, strength: 0.12 },
		level3: { enabled: false, minPaths: 4, strength: 0.04 },
		countScale: "log",
		distance: 90,
		skipDirect: true,
		includeTagLinks: false,
		maxHubDegree: 0,
		maxPerNode: 12,
		maxTotal: 0,
	},
	controls: [
		{ type: "toggle", key: "enabled", label: "Enable indirect gravity" },
		{
			type: "toggle",
			key: "directed",
			label: "Follow link direction",
			desc: "On: only A→B→D chains. Off: any shared path, including notes that link to the same note.",
			showIf: (s) => s.enabled,
		},
		{ type: "heading", label: "Second level (A → B → D)", showIf: (s) => s.enabled },
		{ type: "toggle", key: "level2.enabled", label: "Use second-level links", showIf: (s) => s.enabled },
		{ type: "slider", key: "level2.minPaths", label: "Minimum paths", min: 1, max: 20, step: 1, showIf: (s) => s.enabled && s.level2.enabled },
		{ type: "slider", key: "level2.strength", label: "Strength", min: 0, max: 1, step: 0.01, showIf: (s) => s.enabled && s.level2.enabled },
		{ type: "heading", label: "Third level (A → B → C → D)", showIf: (s) => s.enabled },
		{ type: "toggle", key: "level3.enabled", label: "Use third-level links", showIf: (s) => s.enabled },
		{ type: "slider", key: "level3.minPaths", label: "Minimum paths", min: 1, max: 50, step: 1, showIf: (s) => s.enabled && s.level3.enabled },
		{ type: "slider", key: "level3.strength", label: "Strength", min: 0, max: 1, step: 0.01, showIf: (s) => s.enabled && s.level3.enabled },
		{ type: "heading", label: "Tuning", showIf: (s) => s.enabled },
		{ type: "dropdown", key: "countScale", label: "Path-count scaling", options: SCALE_MODE_LABELS, showIf: (s) => s.enabled },
		{ type: "slider", key: "distance", label: "Indirect distance", min: 10, max: 400, step: 5, showIf: (s) => s.enabled },
		{ type: "toggle", key: "skipDirect", label: "Skip directly linked pairs", showIf: (s) => s.enabled },
		{ type: "toggle", key: "includeTagLinks", label: "Walk through tags", desc: "Requires tags to be shown.", showIf: (s) => s.enabled },
		{ type: "slider", key: "maxPerNode", label: "Max partners per note (0 = ∞)", min: 0, max: 100, step: 1, showIf: (s) => s.enabled },
		{
			type: "slider",
			key: "maxHubDegree",
			label: "Hub cap (0 = auto)",
			desc: "Notes with more connections than this aren't walked through (e.g. big index notes).",
			min: 0,
			max: 1000,
			step: 10,
			showIf: (s) => s.enabled,
		},
	],
	apply(ctx, s) {
		const pull = (count: number, level: IndirectLevelSettings) => (count > 0 ? level.strength * scaleCount(count, s.countScale) : 0);
		ctx.setLinkPhysics("indirect", {
			strength: (link) => {
				const info = link.indirect;
				if (!s.enabled || !info) return 0;
				return Math.min(1, pull(info.level2, s.level2) + pull(info.level3, s.level3));
			},
			distance: () => s.distance,
		});
	},
	augmentKey(s) {
		if (!s.enabled) return "off";
		const { directed, level2, level3, skipDirect, includeTagLinks, maxHubDegree, maxPerNode, maxTotal } = s;
		return stableKey({
			directed,
			l2: [level2.enabled, level2.minPaths],
			l3: [level3.enabled, level3.minPaths],
			skipDirect,
			includeTagLinks,
			maxHubDegree,
			maxPerNode,
			maxTotal,
		});
	},
	async augment(ctx, s) {
		if (!s.enabled || (!s.level2.enabled && !s.level3.enabled)) return [];
		const options = indirectOptions(s, ctx.model.nodes.length, ctx.plan.hubCap, ctx.plan.workBudgetPerNode);
		const { input, ids } = indirectInputFromModel(ctx.model, options, s.includeTagLinks);
		const output = await ctx.compute("indirect", input);
		return indirectLinksFromOutput(output, ids);
	},
};
