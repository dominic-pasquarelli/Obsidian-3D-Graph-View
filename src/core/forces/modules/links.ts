import type { GraphLink, GraphNode } from "../../graph/types";
import { combineCounts, referenceMultiplier, scaleCount, SCALE_MODE_LABELS, type CombineMode, type ScaleMode } from "../../graph/strength";
import type { ForceModule } from "../types";

export interface LinkForceSettings {
	/** Base pull of a single reference. */
	strength: number;
	/** Rest length of a link with a single reference. */
	distance: number;
	/** Divide pull by the smaller endpoint degree (keeps hubs stable, like d3's default). */
	normalizeByDegree: boolean;
	/** How reference counts grow the pull. */
	referenceScale: ScaleMode;
	/** 0 = counts ignored, 1 = full effect, 2 = exaggerated. */
	referenceInfluence: number;
	/** Upper bound for the reference multiplier. */
	maxMultiplier: number;
	/** How A→B and B→A counts combine. */
	combine: CombineMode;
	/** How much extra references shorten the link (0 = not at all). */
	distanceInfluence: number;
	/** Pull of note → tag links relative to `strength`. */
	tagStrength: number;
}

function endDegree(end: string | GraphNode): number {
	return typeof end === "string" ? 1 : Math.max(1, end.degree);
}

export function linkReferences(link: GraphLink, combine: CombineMode): number {
	return Math.max(1, combineCounts(link.forward, link.backward, combine));
}

export const linkForceModule: ForceModule<LinkForceSettings> = {
	id: "links",
	label: "Links & reference weighting",
	description: "Springs between linked notes. The more often a note references another, the stronger and shorter the spring.",
	defaults: {
		strength: 0.5,
		distance: 45,
		normalizeByDegree: true,
		referenceScale: "log",
		referenceInfluence: 1,
		maxMultiplier: 4,
		combine: "sum",
		distanceInfluence: 0.5,
		tagStrength: 0.4,
	},
	controls: [
		{ type: "slider", key: "strength", label: "Link strength", min: 0, max: 1.5, step: 0.05 },
		{ type: "slider", key: "distance", label: "Link distance", min: 5, max: 300, step: 5 },
		{ type: "heading", label: "Reference weighting", desc: "Pull grows with how many times a note references another." },
		{ type: "dropdown", key: "referenceScale", label: "Count scaling", options: SCALE_MODE_LABELS },
		{
			type: "slider",
			key: "referenceInfluence",
			label: "Influence on pull",
			min: 0,
			max: 2,
			step: 0.05,
			showIf: (s) => s.referenceScale !== "off",
		},
		{ type: "slider", key: "maxMultiplier", label: "Max multiplier", min: 1, max: 10, step: 0.5, showIf: (s) => s.referenceScale !== "off" },
		{
			type: "slider",
			key: "distanceInfluence",
			label: "Influence on distance",
			desc: "Heavily referenced notes sit closer.",
			min: 0,
			max: 1,
			step: 0.05,
			showIf: (s) => s.referenceScale !== "off",
		},
		{ type: "dropdown", key: "combine", label: "Two-way links", options: { sum: "Add both directions", max: "Use the larger direction" } },
		{ type: "toggle", key: "normalizeByDegree", label: "Soften hubs", desc: "Divide pull by the smaller endpoint's connection count." },
		{ type: "slider", key: "tagStrength", label: "Tag link strength", min: 0, max: 1.5, step: 0.05 },
	],
	apply(ctx, s) {
		const multiplier = (link: GraphLink) =>
			s.referenceScale === "off" ? 1 : referenceMultiplier(linkReferences(link, s.combine), s.referenceScale, s.referenceInfluence, s.maxMultiplier);
		const norm = (link: GraphLink) => (s.normalizeByDegree ? 1 / Math.min(endDegree(link.source), endDegree(link.target)) : 1);
		ctx.setLinkPhysics("direct", {
			strength: (link) => Math.min(1, s.strength * norm(link) * multiplier(link)),
			distance: (link) => {
				if (s.referenceScale === "off" || s.distanceInfluence <= 0) return s.distance;
				const scaled = scaleCount(linkReferences(link, s.combine), s.referenceScale);
				return Math.max(s.distance * 0.2, s.distance / (1 + s.distanceInfluence * (scaled - 1)));
			},
		});
		ctx.setLinkPhysics("tag", {
			strength: (link) => Math.min(1, s.strength * s.tagStrength * norm(link)),
			distance: () => s.distance,
		});
	},
};
