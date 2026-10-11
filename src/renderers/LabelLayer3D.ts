import { Group, type Scene, type SpriteMaterial } from "three";
import SpriteText from "three-spritetext";
import type { GraphNode } from "../core/graph/types";
import type { StyleResolver } from "./style";

interface LabelEntry {
	node: GraphNode;
	sprite: SpriteText;
}

/**
 * Text labels for the 3D view, kept separate from node objects so labels can
 * change (hover, budget, size) without rebuilding every node mesh. Positions
 * follow their nodes on each animation frame; only labelled nodes cost anything.
 */
export class LabelLayer3D {
	private group = new Group();
	private entries = new Map<string, LabelEntry>();
	private frame = 0;
	private frameCount = 0;
	private disposed = false;
	private worldHeight = 5;

	constructor(
		scene: Scene,
		private readonly style: StyleResolver,
	) {
		this.group.name = "3d-graph-view-labels";
		scene.add(this.group);
	}

	/** Reconciles sprites with the set of nodes the style wants labelled. */
	sync(): void {
		if (this.disposed) return;
		const wanted = this.style.labelledNodes();
		const wantedIds = new Set(wanted.map((n) => n.id));
		for (const [id, entry] of this.entries) {
			if (!wantedIds.has(id) || entry.node !== this.style.model?.nodeById.get(id)) this.remove(id);
		}
		this.worldHeight = this.measureHeight();
		const height = this.worldHeight;
		const color = this.style.labelColor();
		for (const node of wanted) {
			let entry = this.entries.get(node.id);
			if (!entry) {
				const sprite = new SpriteText(this.style.labelText(node), height, color);
				sprite.fontFace = "Inter, system-ui, sans-serif";
				sprite.renderOrder = 10;
				const material = sprite.material as SpriteMaterial;
				material.depthWrite = false;
				material.transparent = true;
				entry = { node, sprite };
				this.entries.set(node.id, entry);
				this.group.add(sprite);
			}
			const { sprite } = entry;
			if (sprite.text !== this.style.labelText(node)) sprite.text = this.style.labelText(node);
			if (sprite.textHeight !== height) sprite.textHeight = height;
			if (sprite.color !== color) sprite.color = color;
			(sprite.material as SpriteMaterial).opacity = this.style.labelAlpha3D(node);
		}
		this.updatePositions();
		if (this.entries.size > 0 && !this.frame) this.loop();
	}

	/** Label height in world units, scaled to the graph's spread so labels stay readable at "fit" zoom. */
	private measureHeight(): number {
		const nodes = this.style.model?.nodes ?? [];
		let max = 0;
		for (const n of nodes) {
			const d = Math.hypot(n.x ?? 0, n.y ?? 0, n.z ?? 0);
			if (Number.isFinite(d) && d > max) max = d;
		}
		return this.style.view.labels.size * Math.max(4, max * 0.03);
	}

	private loop = () => {
		if (this.disposed || this.entries.size === 0) {
			this.frame = 0;
			return;
		}
		// The layout expands while it settles; rescale labels occasionally.
		if (++this.frameCount % 45 === 0) {
			const h = this.measureHeight();
			if (Math.abs(h - this.worldHeight) / this.worldHeight > 0.15) {
				this.worldHeight = h;
				for (const { sprite } of this.entries.values()) sprite.textHeight = h;
			}
		}
		this.updatePositions();
		this.frame = requestAnimationFrame(this.loop);
	};

	private updatePositions(): void {
		for (const { node, sprite } of this.entries.values()) {
			const r = this.style.nodeRadius(node);
			sprite.position.set(node.x ?? 0, (node.y ?? 0) + r + sprite.textHeight * 0.75, node.z ?? 0);
		}
	}

	private remove(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.group.remove(entry.sprite);
		const material = entry.sprite.material as SpriteMaterial;
		material.map?.dispose();
		material.dispose();
		this.entries.delete(id);
	}

	dispose(): void {
		this.disposed = true;
		if (this.frame) cancelAnimationFrame(this.frame);
		for (const id of Array.from(this.entries.keys())) this.remove(id);
		this.group.parent?.remove(this.group);
	}
}
