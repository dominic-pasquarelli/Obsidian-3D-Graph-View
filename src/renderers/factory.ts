import type { GraphMode } from "../core/settings/view";
import { Renderer2D } from "./Renderer2D";
import { Renderer3D } from "./Renderer3D";
import type { GraphRenderer, RendererOptions } from "./types";

/** One place that maps a view mode to a renderer. Add new backends here. */
export function createRenderer(mode: GraphMode, options: RendererOptions): GraphRenderer {
	return mode === "2d" ? new Renderer2D(options) : new Renderer3D(options);
}
