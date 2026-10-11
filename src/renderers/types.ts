import type { LinkForce } from "d3-force-3d";
import type { ForceEngine } from "../core/forces/types";
import type { GraphLink, GraphNode } from "../core/graph/types";
import type { Controls3D } from "../core/settings/view";
import type { StyleResolver } from "./style";

export interface RendererEvents {
	onNodeClick(node: GraphNode, event: MouseEvent): void;
	onNodeRightClick(node: GraphNode, event: MouseEvent): void;
	onNodeHover(node: GraphNode | null): void;
	onNodeDrag(node: GraphNode): void;
	onNodeDragEnd(node: GraphNode): void;
	onBackgroundClick(event: MouseEvent): void;
}

export interface RendererOptions {
	container: HTMLElement;
	style: StyleResolver;
	events: RendererEvents;
	controls3d: Controls3D;
}

/**
 * What the controller needs from a rendering backend. Both the 3D (WebGL) and
 * 2D (canvas) renderers implement this, and both share one StyleResolver and
 * one set of force modules — so they always behave the same.
 */
export interface GraphRenderer {
	readonly dims: 2 | 3;
	readonly engine: ForceEngine;
	setData(nodes: GraphNode[], links: GraphLink[]): void;
	linkForce(): LinkForce<GraphNode, GraphLink> | undefined;
	/** Re-evaluate colours / widths / visibility after the style state changed (cheap). */
	refreshStyle(): void;
	/** Re-apply everything that depends on view settings or the performance plan. */
	applySettings(): void;
	resize(width: number, height: number): void;
	focusNode(node: GraphNode, durationMs?: number): void;
	/** Node position in container pixels (for overlays, tests, future features). */
	screenPosition(node: GraphNode): { x: number; y: number } | null;
	zoomToFit(durationMs?: number): void;
	reheat(): void;
	dispose(): void;
}

/** Removes library-private bookkeeping (`__threeObj`, `__indexColor`, …) so data can move between renderers. */
export function stripPrivateKeys(items: object[]): void {
	for (const item of items) {
		for (const key of Object.keys(item)) if (key.startsWith("__")) delete (item as Record<string, unknown>)[key];
	}
}
