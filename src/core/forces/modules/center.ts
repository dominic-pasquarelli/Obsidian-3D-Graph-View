import { forceCenter, forceX, forceY, forceZ } from "d3-force-3d";
import type { GraphNode } from "../../graph/types";
import type { ForceModule } from "../types";

export interface CenterSettings {
	/** Keep the graph's centre of mass at the origin (no effect on shape). */
	recenter: boolean;
	/** Pull every node towards the origin (keeps orphans and islands nearby). */
	gravity: number;
}

export const centerForceModule: ForceModule<CenterSettings> = {
	id: "center",
	label: "Centering",
	description: "Gently pulls everything towards the middle so disconnected islands don't drift away.",
	defaults: { recenter: true, gravity: 0.04 },
	controls: [
		{ type: "slider", key: "gravity", label: "Center force", min: 0, max: 0.5, step: 0.005 },
		{ type: "toggle", key: "recenter", label: "Keep graph centred", desc: "Shifts the whole layout so it stays in the middle of the view." },
	],
	apply(ctx, s) {
		// Owning "center" (instead of relying on the renderer library's default) keeps
		// main-thread and worker physics identical.
		ctx.engine.setForce("center", s.recenter ? forceCenter<GraphNode>(0, 0, 0) : null);
		const make = (f: typeof forceX) => (s.gravity > 0 ? f<GraphNode>(0).strength(s.gravity) : null);
		ctx.engine.setForce("gravityX", make(forceX));
		ctx.engine.setForce("gravityY", make(forceY));
		ctx.engine.setForce("gravityZ", ctx.dims === 3 ? make(forceZ) : null);
	},
};
