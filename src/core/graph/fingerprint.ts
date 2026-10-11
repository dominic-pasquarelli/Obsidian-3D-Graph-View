import type { GraphModel } from "./types";
import { linkEndId } from "./types";

/** 32-bit FNV-1a, fed incrementally. */
class Fnv {
	private h = 0x811c9dc5;
	add(text: string): this {
		for (let i = 0; i < text.length; i++) {
			this.h ^= text.charCodeAt(i);
			this.h = Math.imul(this.h, 0x01000193);
		}
		this.h ^= 0x1f;
		this.h = Math.imul(this.h, 0x01000193);
		return this;
	}
	value(): string {
		return (this.h >>> 0).toString(36);
	}
}

/**
 * Cheap structural hash of a model: nodes, kinds, colours and link counts.
 * Lets the view skip re-pushing data (and re-heating the physics) when an edit
 * changed only note text.
 */
export function modelFingerprint(model: GraphModel): string {
	const h = new Fnv();
	h.add(String(model.nodes.length)).add(String(model.links.length));
	for (const n of model.nodes) h.add(n.id).add(n.kind).add(n.name).add(n.color ?? "").add(String(n.group));
	for (const l of model.links) h.add(l.id).add(linkEndId(l.source)).add(String(l.forward)).add(String(l.backward));
	return h.value();
}
