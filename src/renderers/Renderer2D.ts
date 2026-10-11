import ForceGraph from "force-graph";
import type { LinkForce } from "d3-force-3d";
import type { GraphLink, GraphNode } from "../core/graph/types";
import { withAlpha } from "../core/util/color";
import { LibraryForceEngine, type ForceGraphLike } from "./engine";
import type { StyleResolver } from "./style";
import { stripPrivateKeys, type GraphRenderer, type RendererOptions } from "./types";

type Instance = ForceGraph<GraphNode, GraphLink>;

/** Canvas renderer backed by force-graph. Same physics and style as the 3D view. */
export class Renderer2D implements GraphRenderer {
	readonly dims = 2 as const;
	readonly engine: LibraryForceEngine;
	private graph: Instance;
	private style: StyleResolver;
	private nodes: GraphNode[] = [];
	private links: GraphLink[] = [];

	constructor(private readonly options: RendererOptions) {
		this.style = options.style;
		const { container, events } = options;
		this.graph = new ForceGraph<GraphNode, GraphLink>(container);
		const g = this.graph;
		g.nodeRelSize(1)
			.nodeVal((n) => Math.pow(this.style.nodeRadius(n), 2))
			.nodeLabel(() => "")
			.nodeCanvasObjectMode(() => "replace")
			.nodeCanvasObject((n, ctx, scale) => this.drawNode(n, ctx, scale))
			.nodePointerAreaPaint((n, color, ctx) => {
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.arc(n.x ?? 0, n.y ?? 0, this.style.nodeRadius(n) + 1, 0, 2 * Math.PI);
				ctx.fill();
			})
			.linkVisibility((l) => this.style.linkVisible(l))
			.linkColor((l) => this.style.linkColor(l))
			.linkWidth((l) => this.style.linkWidth(l))
			.linkLineDash((l) => (l.kind === "indirect" ? [2, 3] : null))
			.linkDirectionalArrowLength((l) => this.style.arrowLength(l))
			.linkDirectionalArrowRelPos(1)
			.linkDirectionalArrowColor((l) => this.style.linkColor(l))
			.linkDirectionalParticles((l) => this.style.linkParticles(l))
			.linkDirectionalParticleWidth(2)
			.linkDirectionalParticleColor(() => this.style.particleColor())
			.onNodeClick((n, e) => events.onNodeClick(n, e))
			.onNodeRightClick((n, e) => events.onNodeRightClick(n, e))
			.onNodeHover((n) => {
				container.style.cursor = n ? "pointer" : "";
				events.onNodeHover(n);
			})
			.onNodeDrag((n) => events.onNodeDrag(n))
			.onNodeDragEnd((n) => events.onNodeDragEnd(n))
			.onBackgroundClick((e) => events.onBackgroundClick(e));
		this.engine = new LibraryForceEngine(g as unknown as ForceGraphLike, 2);
		this.applySettings();
	}

	private drawNode(node: GraphNode, ctx: CanvasRenderingContext2D, scale: number): void {
		const style = this.style;
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		const r = style.nodeRadius(node);
		const base = style.nodeBaseColor(node);
		const alpha = style.nodeAlpha(node);
		ctx.beginPath();
		ctx.arc(x, y, r, 0, 2 * Math.PI);
		if (node.kind === "unresolved") {
			// Not-yet-created notes: hollow with a dashed ring.
			ctx.fillStyle = withAlpha(base, alpha * 0.35);
			ctx.fill();
			ctx.setLineDash([1.5, 1.5]);
			ctx.lineWidth = Math.max(0.6, 1.2 / scale);
			ctx.strokeStyle = withAlpha(base, Math.min(1, alpha * 2));
			ctx.stroke();
			ctx.setLineDash([]);
		} else {
			ctx.fillStyle = withAlpha(base, alpha);
			ctx.fill();
		}
		if (style.isActive(node) || (style.hovered === node.id && style.view.interaction.highlightOnHover)) {
			ctx.beginPath();
			ctx.arc(x, y, r + 2 / scale + 0.8, 0, 2 * Math.PI);
			ctx.lineWidth = 1.5 / scale;
			ctx.strokeStyle = withAlpha(style.theme.accent, 0.9);
			ctx.stroke();
		}
		const labelAlpha = style.labelAlpha2D(node, scale);
		if (labelAlpha > 0.02) {
			const fontSize = (11 * style.view.labels.size) / scale;
			ctx.font = `${node.kind === "unresolved" ? "italic " : ""}${fontSize}px Inter, system-ui, sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillStyle = withAlpha(style.labelColor(), labelAlpha);
			ctx.fillText(style.labelText(node), x, y + r + 2 / scale);
		}
	}

	setData(nodes: GraphNode[], links: GraphLink[]): void {
		this.nodes = nodes;
		this.links = links;
		this.graph.graphData({ nodes, links });
	}

	linkForce(): LinkForce<GraphNode, GraphLink> | undefined {
		return this.graph.d3Force("link") as unknown as LinkForce<GraphNode, GraphLink> | undefined;
	}

	refreshStyle(): void {
		const g = this.graph;
		g.linkColor(g.linkColor())
			.linkWidth(g.linkWidth())
			.linkVisibility(g.linkVisibility())
			.linkDirectionalArrowLength(g.linkDirectionalArrowLength())
			.linkDirectionalParticles(g.linkDirectionalParticles())
			.nodeVal(g.nodeVal());
	}

	applySettings(): void {
		const { view } = this.style;
		this.graph
			.backgroundColor(this.style.background())
			.linkDirectionalParticleSpeed(view.links.particleSpeed)
			.autoPauseRedraw(view.links.particles !== "all");
		this.refreshStyle();
	}

	resize(width: number, height: number): void {
		this.graph.width(Math.max(1, width)).height(Math.max(1, height));
	}

	focusNode(node: GraphNode, durationMs = 700): void {
		this.graph.centerAt(node.x ?? 0, node.y ?? 0, durationMs);
		this.graph.zoom(Math.max(this.graph.zoom(), 3), durationMs);
	}

	screenPosition(node: GraphNode): { x: number; y: number } | null {
		if (!Number.isFinite(node.x)) return null;
		return this.graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0);
	}

	zoomToFit(durationMs = 500): void {
		this.graph.zoomToFit(durationMs, 40);
	}

	reheat(): void {
		this.graph.d3ReheatSimulation();
	}

	dispose(): void {
		this.graph.pauseAnimation();
		this.graph._destructor();
		stripPrivateKeys(this.nodes);
		stripPrivateKeys(this.links);
		this.options.container.replaceChildren();
	}
}
