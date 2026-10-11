import type { GraphLink, GraphModel, GraphNode } from "../core/graph/types";
import { linkEndId } from "../core/graph/types";
import type { PerformancePlan } from "../core/perf/scaling";
import type { ViewSettings } from "../core/settings/view";
import { withAlpha } from "../core/util/color";

export interface ResolvedTheme {
	background: string;
	text: string;
	textMuted: string;
	accent: string;
	isDark: boolean;
}

export const SPACE_BACKGROUND = "#05060f";

/**
 * Single source of truth for how nodes and links look. Renderer-agnostic:
 * the 2D and 3D renderers both read from it, which is what keeps the two views
 * consistent. Holds hover / active-note highlight state too.
 */
export class StyleResolver {
	view!: ViewSettings;
	plan!: PerformancePlan;
	theme!: ResolvedTheme;
	model: GraphModel | null = null;

	private hoverId: string | null = null;
	private activeId: string | null = null;
	private highlightNodes = new Set<string>();
	private highlightLinks = new Set<string>();
	private labelSet = new Set<string>();
	private labelsDirty = true;
	/** 2 or 3 — 3D shows fewer, larger persistent labels because perspective already crowds them. */
	dims: 2 | 3 = 3;

	configure(view: ViewSettings, plan: PerformancePlan, theme: ResolvedTheme): void {
		this.view = view;
		this.plan = plan;
		this.theme = theme;
		this.labelsDirty = true;
		this.recomputeHighlight();
	}

	setDims(dims: 2 | 3): void {
		if (dims === this.dims) return;
		this.dims = dims;
		this.labelsDirty = true;
	}

	setModel(model: GraphModel): void {
		this.model = model;
		this.labelsDirty = true;
		if (this.hoverId && !model.nodeById.has(this.hoverId)) this.hoverId = null;
		this.recomputeHighlight();
	}

	/** Returns true if the highlight changed. */
	setHover(id: string | null): boolean {
		if (id === this.hoverId) return false;
		this.hoverId = id;
		this.recomputeHighlight();
		return this.view.interaction.highlightOnHover || this.view.labels.mode === "hover";
	}

	setActive(id: string | null): boolean {
		if (id === this.activeId) return false;
		this.activeId = id;
		return this.view.interaction.highlightActive;
	}

	get hovered(): string | null {
		return this.hoverId;
	}

	private recomputeHighlight(): void {
		this.highlightNodes.clear();
		this.highlightLinks.clear();
		const id = this.hoverId;
		if (!id || !this.model || !this.view) return;
		this.highlightNodes.add(id);
		const consider = (links: GraphLink[]) => {
			for (const link of links) {
				if (!this.linkVisible(link)) continue;
				const s = linkEndId(link.source);
				const t = linkEndId(link.target);
				if (s !== id && t !== id) continue;
				this.highlightLinks.add(link.id);
				this.highlightNodes.add(s === id ? t : s);
			}
		};
		consider(this.model.links);
		consider(this.model.extraLinks);
	}

	private get dimming(): boolean {
		return this.hoverId !== null && this.view.interaction.highlightOnHover;
	}

	isHighlighted(node: GraphNode): boolean {
		return this.highlightNodes.has(node.id);
	}

	isActive(node: GraphNode): boolean {
		return this.view.interaction.highlightActive && node.id === this.activeId;
	}

	background(): string {
		const s = this.view.style;
		if (s.background === "space") return SPACE_BACKGROUND;
		if (s.background === "custom") return s.customBackground;
		return this.theme.background;
	}

	nodeBaseColor(node: GraphNode): string {
		if (this.isActive(node)) return this.theme.accent;
		if (node.color) return node.color;
		const c = this.view.colors;
		switch (node.kind) {
			case "unresolved":
				return c.unresolved;
			case "attachment":
				return c.attachment;
			case "tag":
				return c.tag;
			default:
				return c.note;
		}
	}

	nodeAlpha(node: GraphNode): number {
		let alpha = node.kind === "unresolved" ? this.view.colors.unresolvedOpacity : this.view.nodes.opacity;
		if (this.dimming && !this.highlightNodes.has(node.id)) alpha *= this.view.interaction.dimOpacity;
		return alpha;
	}

	nodeColor(node: GraphNode): string {
		return withAlpha(this.nodeBaseColor(node), this.nodeAlpha(node));
	}

	/** Visual radius in graph units; identical in 2D and 3D. */
	nodeRadius(node: GraphNode): number {
		const n = this.view.nodes;
		const metric = n.sizeBy === "degree" ? node.degree : n.sizeBy === "inRefs" ? node.inRefs : 0;
		let r = n.size * 0.5 * (1 + n.sizeScale * 0.45 * Math.sqrt(metric));
		if (node.kind === "unresolved") r *= 0.8;
		if (this.isActive(node)) r *= 1.25;
		return r;
	}

	linkVisible(link: GraphLink): boolean {
		return link.kind !== "indirect" || this.view.links.showIndirect;
	}

	isLinkHighlighted(link: GraphLink): boolean {
		return this.highlightLinks.has(link.id);
	}

	/** Link colour as hex + alpha (used directly by batched renderers). */
	linkColorParts(link: GraphLink): { hex: string; alpha: number } {
		const l = this.view.links;
		if (this.highlightLinks.has(link.id)) return { hex: this.theme.accent, alpha: Math.min(1, Math.max(0.6, l.opacity * 2)) };
		let alpha = (link.kind === "indirect" ? l.indirectOpacity : l.opacity) * this.plan.linkOpacityScale;
		if (this.dimming) alpha *= this.view.interaction.dimOpacity;
		return { hex: link.kind === "indirect" ? this.theme.accent : this.theme.textMuted, alpha };
	}

	linkColor(link: GraphLink): string {
		const { hex, alpha } = this.linkColorParts(link);
		return withAlpha(hex, alpha);
	}

	linkReferences(link: GraphLink): number {
		return Math.max(1, link.forward + link.backward);
	}

	linkWidth(link: GraphLink): number {
		const l = this.view.links;
		if (link.kind === "indirect") return l.width * 0.5;
		const grow = l.widthByRefs ? 1 + 0.6 * Math.log2(this.linkReferences(link)) : 1;
		const w = l.width * grow;
		return this.highlightLinks.has(link.id) ? Math.max(w * 1.6, 0.8) : w;
	}

	arrowLength(link: GraphLink): number {
		if (!this.view.links.arrows || link.kind !== "direct" || !this.plan.allowArrows) return 0;
		return 2.5 + this.view.links.width;
	}

	linkParticles(link: GraphLink): number {
		const mode = this.view.links.particles;
		if (mode === "off" || link.kind === "indirect") return 0;
		if (this.highlightLinks.has(link.id)) return Math.min(4, 1 + Math.round(Math.log2(this.linkReferences(link))));
		if (mode === "all" && this.plan.allowParticles && !this.dimming) return Math.min(3, Math.ceil(Math.log2(this.linkReferences(link) + 1)));
		return 0;
	}

	particleColor(): string {
		return this.theme.accent;
	}

	// ---- Labels -----------------------------------------------------------------------------

	private ensureLabels(): void {
		if (!this.labelsDirty || !this.model) return;
		this.labelsDirty = false;
		this.labelSet.clear();
		const mode = this.view.labels.mode;
		if (mode === "never" || mode === "hover") return;
		const nodes = this.model.nodes;
		const budget = mode === "always" ? (this.dims === 3 ? 1500 : Infinity) : this.dims === 3 ? Math.min(40, Math.ceil(this.plan.labelBudget / 8)) : this.plan.labelBudget;
		if (nodes.length <= budget) {
			for (const n of nodes) this.labelSet.add(n.id);
			return;
		}
		const ranked = nodes.slice().sort((a, b) => b.degree + b.inRefs - (a.degree + a.inRefs));
		for (let i = 0; i < budget && i < ranked.length; i++) this.labelSet.add(ranked[i].id);
	}

	/** Persistent (always drawn) labels, before any zoom-based reveal. */
	hasPersistentLabel(node: GraphNode): boolean {
		if (this.view.labels.mode === "never") return false;
		this.ensureLabels();
		return this.labelSet.has(node.id) || this.highlightNodes.has(node.id) || this.isActive(node);
	}

	/** Label opacity for a 2D zoom level (globalScale); 0 = hidden. */
	labelAlpha2D(node: GraphNode, zoom: number): number {
		const mode = this.view.labels.mode;
		if (mode === "never") return 0;
		const emphasised = this.highlightNodes.has(node.id) || this.isActive(node);
		let alpha: number;
		if (emphasised || mode === "always") alpha = 1;
		else if (mode === "hover") alpha = 0;
		else {
			this.ensureLabels();
			const t = this.view.labels.zoomThreshold;
			const important = this.labelSet.has(node.id) && this.labelSet.size < (this.model?.nodes.length ?? 0);
			const threshold = important ? t * 0.5 : t;
			alpha = Math.max(0, Math.min(1, (zoom - threshold * 0.75) / (threshold * 0.25)));
		}
		if (this.dimming && !emphasised) alpha *= this.view.interaction.dimOpacity;
		return alpha;
	}

	labelAlpha3D(node: GraphNode): number {
		const emphasised = this.highlightNodes.has(node.id) || this.isActive(node);
		return this.dimming && !emphasised ? Math.max(0.05, this.view.interaction.dimOpacity) : 1;
	}

	labelText(node: GraphNode): string {
		return node.name;
	}

	labelColor(): string {
		return this.view.style.background === "space" ? "#e6e8f0" : this.theme.text;
	}

	/** Every node that currently wants a 3D label sprite. */
	labelledNodes(): GraphNode[] {
		if (!this.model || this.view.labels.mode === "never") return [];
		this.ensureLabels();
		const out: GraphNode[] = [];
		for (const node of this.model.nodes) if (this.hasPersistentLabel(node)) out.push(node);
		return out;
	}
}
