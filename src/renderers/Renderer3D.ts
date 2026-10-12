import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import type { LinkForce } from "d3-force-3d";
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Vector2 } from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { GraphLink, GraphNode } from "../core/graph/types";
import { LibraryForceEngine, type ForceGraphLike } from "./engine";
import { LabelLayer3D } from "./LabelLayer3D";
import { LinkBatch3D } from "./LinkBatch3D";
import { parseHex } from "../core/util/color";
import type { StyleResolver } from "./style";
import { nodeTooltip } from "./tooltip";
import { stripPrivateKeys, type GraphRenderer, type RendererOptions } from "./types";

type Instance = ForceGraph3DInstance<GraphNode, GraphLink>;

/** WebGL renderer backed by 3d-force-graph (three.js + d3-force-3d). */
export class Renderer3D implements GraphRenderer {
	readonly dims = 3 as const;
	readonly engine: LibraryForceEngine;
	private graph: Instance;
	private style: StyleResolver;
	private labels: LabelLayer3D;
	private bloom: UnrealBloomPass | null = null;
	/** Present on large graphs: ordinary links drawn in one batch, highlighted ones by the library. */
	private batch: LinkBatch3D | null = null;
	private nodes: GraphNode[] = [];
	private links: GraphLink[] = [];
	private size = { width: 1, height: 1 };
	private releaseGuard: () => void;
	/** Two-colour lines for gradient links (the library's own lines are single-coloured). */
	private gradientLines = new Map<GraphLink, Line>();

	constructor(private readonly options: RendererOptions) {
		this.style = options.style;
		const { container, events } = options;
		const Ctor = ForceGraph3D as unknown as new (el: HTMLElement, cfg: object) => Instance;
		this.graph = new Ctor(container, { controlType: options.controls3d });
		const g = this.graph;
		g.showNavInfo(false)
			.nodeRelSize(1)
			.nodeOpacity(1)
			.linkOpacity(1)
			.nodeVal((n) => Math.pow(this.style.nodeRadius(n), 3))
			.nodeColor((n) => this.style.nodeColor(n))
			.nodeLabel((n) => (this.style.view.labels.mode === "never" ? "" : nodeTooltip(n)))
			.linkVisibility((l) => this.style.linkVisible(l) && (!this.batch || this.style.isLinkHighlighted(l)))
			.linkColor((l) => this.style.linkColor(l))
			.linkWidth((l) => this.linkWidth(l))
			.linkThreeObject(((l: GraphLink) => (this.style.isGradient(l) ? this.makeGradientLine(l) : null)) as never)
			.linkPositionUpdate((obj, { start, end }, l) => {
				const line = this.gradientLines.get(l);
				if (!line || obj !== line) return false;
				const pos = line.geometry.getAttribute("position") as BufferAttribute;
				pos.setXYZ(0, start.x, start.y, start.z);
				pos.setXYZ(1, end.x, end.y, end.z);
				pos.needsUpdate = true;
				line.geometry.computeBoundingSphere();
				return true;
			})
			.linkDirectionalArrowLength((l) => this.style.arrowLength(l))
			.linkDirectionalArrowRelPos(1)
			.linkDirectionalArrowColor((l) => this.style.linkColor(l))
			.linkDirectionalParticles((l) => this.style.linkParticles(l))
			.linkDirectionalParticleWidth(1.6)
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
		this.engine = new LibraryForceEngine(g as unknown as ForceGraphLike, 3);
		this.releaseGuard = guardSyntheticPointerUp(container.ownerDocument);
		this.labels = new LabelLayer3D(g.scene(), () => g.camera(), () => this.size, this.style);
		g.onEngineTick(() => this.batch?.updatePositions());
		this.applySettings();
	}

	private makeGradientLine(link: GraphLink): Line {
		const geometry = new BufferGeometry();
		geometry.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
		geometry.setAttribute("color", new BufferAttribute(new Float32Array(8), 4));
		const line = new Line(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
		this.gradientLines.set(link, line);
		this.colorGradientLine(link, line);
		return line;
	}

	private colorGradientLine(link: GraphLink, line: Line): void {
		const ends = this.style.linkEnds(link);
		const color = line.geometry.getAttribute("color") as BufferAttribute;
		const a = parseHex(ends.source) ?? { r: 136, g: 136, b: 136 };
		const b = parseHex(ends.target) ?? a;
		color.setXYZW(0, a.r / 255, a.g / 255, a.b / 255, ends.alpha);
		color.setXYZW(1, b.r / 255, b.g / 255, b.b / 255, ends.alpha);
		color.needsUpdate = true;
	}

	/** Thin GL lines for big graphs (one draw call is cheaper than a cylinder mesh). */
	private linkWidth(link: GraphLink): number {
		const width = this.style.linkWidth(link);
		const tier = this.style.plan.tier;
		if (tier === "small" || tier === "medium" || this.style.isLinkHighlighted(link)) return width;
		return 0;
	}

	setData(nodes: GraphNode[], links: GraphLink[]): void {
		this.nodes = nodes;
		this.links = links;
		this.graph.graphData({ nodes, links });
		this.batch?.setLinks(links);
		this.labels.sync();
	}

	linkForce(): LinkForce<GraphNode, GraphLink> | undefined {
		return this.graph.d3Force("link") as unknown as LinkForce<GraphNode, GraphLink> | undefined;
	}

	refreshStyle(): void {
		const g = this.graph;
		// Re-setting linkWidth rebuilds link objects, which re-decides which links are gradients.
		this.gradientLines.clear();
		g.nodeColor(g.nodeColor())
			.nodeVal(g.nodeVal())
			.linkColor(g.linkColor())
			.linkWidth(g.linkWidth())
			.linkVisibility(g.linkVisibility())
			.linkDirectionalArrowLength(g.linkDirectionalArrowLength())
			.linkDirectionalParticles(g.linkDirectionalParticles());
		this.batch?.updateColors();
		this.labels.sync();
	}

	applySettings(): void {
		const { view, plan } = this.style;
		this.graph.backgroundColor(this.style.background()).nodeResolution(plan.nodeResolution).linkDirectionalParticleSpeed(view.links.particleSpeed);
		this.setBloom(view.style.bloom && plan.allowBloom, view.style.bloomStrength);
		if (plan.batchLinks && !this.batch) {
			this.batch = new LinkBatch3D(this.graph.scene(), this.style);
			this.batch.setLinks(this.links);
		} else if (!plan.batchLinks && this.batch) {
			this.batch.dispose();
			this.batch = null;
		} else this.batch?.setLinks(this.links);
		this.refreshStyle();
	}

	private setBloom(enabled: boolean, strength: number): void {
		const composer = this.graph.postProcessingComposer();
		if (!enabled) {
			if (this.bloom) {
				composer.removePass(this.bloom);
				this.bloom.dispose();
				this.bloom = null;
			}
			return;
		}
		if (!this.bloom) {
			this.bloom = new UnrealBloomPass(new Vector2(this.size.width, this.size.height), strength, 0.55, 0.05);
			composer.addPass(this.bloom);
		}
		this.bloom.strength = strength;
	}

	resize(width: number, height: number): void {
		this.size = { width: Math.max(1, width), height: Math.max(1, height) };
		this.graph.width(this.size.width).height(this.size.height);
		this.bloom?.setSize(this.size.width, this.size.height);
		this.labels.sync(); // label size is in screen pixels
	}

	focusNode(node: GraphNode, durationMs = 900): void {
		const x = node.x ?? 0;
		const y = node.y ?? 0;
		const z = node.z ?? 0;
		const distance = 80 + this.style.nodeRadius(node) * 8;
		const ratio = 1 + distance / Math.max(1, Math.hypot(x, y, z));
		this.graph.cameraPosition({ x: x * ratio, y: y * ratio, z: z * ratio }, { x, y, z }, durationMs);
	}

	screenPosition(node: GraphNode): { x: number; y: number } | null {
		if (!Number.isFinite(node.x)) return null;
		const p = this.graph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
		return { x: p.x, y: p.y };
	}

	zoomToFit(durationMs = 600): void {
		this.graph.zoomToFit(durationMs, 40);
	}

	reheat(): void {
		this.graph.d3ReheatSimulation();
	}

	dispose(): void {
		this.releaseGuard();
		this.labels.dispose();
		this.batch?.dispose();
		this.batch = null;
		this.setBloom(false, 0);
		const renderer = this.graph.renderer();
		this.graph.pauseAnimation();
		this.graph._destructor();
		renderer.dispose();
		renderer.forceContextLoss();
		stripPrivateKeys(this.nodes);
		stripPrivateKeys(this.links);
		this.options.container.replaceChildren();
	}
}

/**
 * 3d-force-graph dispatches a synthetic touch "pointerup" on the document after a
 * node drag. three's OrbitControls then looks up a pointer position it never
 * recorded and throws. The real pointerup that follows already releases the
 * controls, so the synthetic one can be dropped safely.
 */
function guardSyntheticPointerUp(doc: Document): () => void {
	const swallow = (e: PointerEvent) => {
		if (!e.isTrusted && e.pointerType === "touch" && e.pointerId === 0) e.stopImmediatePropagation();
	};
	doc.addEventListener("pointerup", swallow, true);
	return () => doc.removeEventListener("pointerup", swallow, true);
}
