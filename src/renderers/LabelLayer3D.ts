import { Group, PerspectiveCamera, Vector3, type Camera, type Scene, type SpriteMaterial } from "three";
import SpriteText from "three-spritetext";
import type { GraphNode } from "../core/graph/types";
import { declutter, type LabelBox } from "./declutter";
import type { StyleResolver } from "./style";

interface LabelEntry {
	node: GraphNode;
	sprite: SpriteText;
	shown: boolean;
}

/** Base label height on screen, in CSS pixels (scaled by the "Label size" setting). */
const LABEL_PX = 13;

/**
 * Text labels for the 3D view. Labels keep a constant size on screen (no giant
 * text up close, no specks far away), carry a halo in the background colour so
 * they read over links, and are de-cluttered every frame: where labels would
 * overlap only the most important one is shown. Kept separate from node meshes
 * so label changes never rebuild the graph.
 */
export class LabelLayer3D {
	private group = new Group();
	private entries = new Map<string, LabelEntry>();
	private frame = 0;
	private disposed = false;
	private projected = new Vector3();

	constructor(
		scene: Scene,
		private readonly camera: () => Camera,
		private readonly viewport: () => { width: number; height: number },
		private readonly style: StyleResolver,
	) {
		this.group.name = "3d-graph-view-labels";
		scene.add(this.group);
	}

	/** World-to-screen factor for sprites with size attenuation off: screen height = scale / (2·tan(fov/2)) × viewport height. */
	private textHeight(): number {
		const cam = this.camera();
		const fov = cam instanceof PerspectiveCamera ? cam.fov : 40;
		const px = LABEL_PX * this.style.view.labels.size;
		return (px * 2 * Math.tan(((fov / 2) * Math.PI) / 180)) / Math.max(1, this.viewport().height);
	}

	/** Reconciles sprites with the set of nodes the style wants labelled. */
	sync(): void {
		if (this.disposed) return;
		const wanted = this.style.labelledNodes();
		const wantedIds = new Set(wanted.map((n) => n.id));
		for (const [id, entry] of this.entries) {
			if (!wantedIds.has(id) || entry.node !== this.style.model?.nodeById.get(id)) this.remove(id);
		}
		const height = this.textHeight();
		const color = this.style.labelColor();
		const halo = this.style.background();
		for (const node of wanted) {
			let entry = this.entries.get(node.id);
			if (!entry) {
				const sprite = new SpriteText(this.style.labelText(node), height, color);
				sprite.fontFace = "Inter, system-ui, sans-serif";
				sprite.fontWeight = "500";
				sprite.strokeWidth = 2;
				sprite.renderOrder = 10;
				sprite.center.set(0.5, -0.35); // sit just above the node
				const material = sprite.material as SpriteMaterial;
				material.sizeAttenuation = false;
				material.depthWrite = false;
				material.depthTest = false;
				material.transparent = true;
				entry = { node, sprite, shown: false };
				this.entries.set(node.id, entry);
				this.group.add(sprite);
			}
			const { sprite } = entry;
			if (sprite.text !== this.style.labelText(node)) sprite.text = this.style.labelText(node);
			if (Math.abs(sprite.textHeight - height) > 1e-6) sprite.textHeight = height;
			if (sprite.color !== color) sprite.color = color;
			if (sprite.strokeColor !== halo) sprite.strokeColor = halo;
		}
		this.update();
		if (this.entries.size > 0 && !this.frame) this.loop();
	}

	private loop = () => {
		if (this.disposed || this.entries.size === 0) {
			this.frame = 0;
			return;
		}
		this.update();
		this.frame = requestAnimationFrame(this.loop);
	};

	/** Follow the nodes, then decide which labels fit on screen. */
	private update(): void {
		const camera = this.camera();
		const { width, height } = this.viewport();
		const px = LABEL_PX * this.style.view.labels.size;
		const boxes: LabelBox[] = [];
		for (const [id, entry] of this.entries) {
			const { node, sprite } = entry;
			const r = this.style.nodeRadius(node);
			sprite.position.set(node.x ?? 0, (node.y ?? 0) + r, node.z ?? 0);
			const p = this.projected.copy(sprite.position).project(camera);
			if (p.z > 1 || p.z < -1) {
				sprite.visible = entry.shown = false;
				continue;
			}
			const sx = ((p.x + 1) / 2) * width;
			const sy = ((1 - p.y) / 2) * height;
			const w = px * (sprite.scale.x / Math.max(1e-9, sprite.scale.y));
			// Box covers the text above the anchor; nearer labels and ones already shown win ties.
			const priority = this.style.labelPriority(node) * (entry.shown ? 1.05 : 1) + (1 - p.z);
			boxes.push({ id, x: sx, y: sy - px * 0.85, w, h: px, priority });
		}
		const keep = declutter(boxes);
		for (const [id, entry] of this.entries) {
			const show = keep.has(id);
			entry.shown = show;
			entry.sprite.visible = show;
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
