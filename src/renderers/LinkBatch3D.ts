import { BufferAttribute, BufferGeometry, DynamicDrawUsage, LineBasicMaterial, LineSegments, type Scene } from "three";
import type { GraphLink, GraphNode } from "../core/graph/types";
import { parseHex } from "../core/util/color";
import type { StyleResolver } from "./style";

/**
 * Draws many 3D links as a single LineSegments object (one draw call) instead
 * of one three.js object per link. Used for large graphs; highlighted links
 * are still drawn individually by the library so they can be thick.
 */
export class LinkBatch3D {
	private geometry = new BufferGeometry();
	private material = new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
	private lines: LineSegments;
	private links: GraphLink[] = [];
	private positions = new Float32Array(0);
	private colors = new Float32Array(0);
	private rgbCache = new Map<string, [number, number, number]>();

	constructor(
		scene: Scene,
		private readonly style: StyleResolver,
	) {
		this.lines = new LineSegments(this.geometry, this.material);
		this.lines.name = "3d-graph-view-link-batch";
		this.lines.frustumCulled = false;
		scene.add(this.lines);
	}

	setLinks(links: GraphLink[]): void {
		this.links = links.filter((l) => this.style.linkVisible(l));
		const n = this.links.length;
		this.positions = new Float32Array(n * 6);
		this.colors = new Float32Array(n * 8);
		const pos = new BufferAttribute(this.positions, 3);
		pos.setUsage(DynamicDrawUsage);
		const col = new BufferAttribute(this.colors, 4);
		col.setUsage(DynamicDrawUsage);
		this.geometry.setAttribute("position", pos);
		this.geometry.setAttribute("color", col);
		this.geometry.setDrawRange(0, n * 2);
		this.updateColors();
		this.updatePositions();
	}

	private rgb(hex: string): [number, number, number] {
		let c = this.rgbCache.get(hex);
		if (!c) {
			const p = parseHex(hex) ?? { r: 136, g: 136, b: 136 };
			c = [p.r / 255, p.g / 255, p.b / 255];
			this.rgbCache.set(hex, c);
		}
		return c;
	}

	updateColors(): void {
		const colors = this.colors;
		this.links.forEach((link, i) => {
			// Each end can have its own colour (gradient links); solid links repeat one colour.
			const { source, target, alpha } = this.style.linkEnds(link);
			const [r1, g1, b1] = this.rgb(source);
			const [r2, g2, b2] = this.rgb(target);
			colors.set([r1, g1, b1, alpha, r2, g2, b2, alpha], i * 8);
		});
		const attr = this.geometry.getAttribute("color");
		if (attr) attr.needsUpdate = true;
	}

	updatePositions(): void {
		const p = this.positions;
		this.links.forEach((link, i) => {
			const s = link.source as GraphNode;
			const t = link.target as GraphNode;
			if (typeof s !== "object" || typeof t !== "object") return;
			const o = i * 6;
			p[o] = s.x ?? 0;
			p[o + 1] = s.y ?? 0;
			p[o + 2] = s.z ?? 0;
			p[o + 3] = t.x ?? 0;
			p[o + 4] = t.y ?? 0;
			p[o + 5] = t.z ?? 0;
		});
		const attr = this.geometry.getAttribute("position");
		if (attr) {
			attr.needsUpdate = true;
			this.geometry.computeBoundingSphere();
		}
	}

	dispose(): void {
		this.lines.parent?.remove(this.lines);
		this.geometry.dispose();
		this.material.dispose();
	}
}
