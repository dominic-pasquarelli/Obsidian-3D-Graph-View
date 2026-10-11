import type { GraphLink, GraphModel } from "./types";
import { linkEndId } from "./types";
import type { IndirectInput, IndirectOptions, IndirectOutput } from "./indirect";

/** Converts the model's links into the compact typed-array input of computeIndirect. */
export function indirectInputFromModel(
	model: GraphModel,
	options: IndirectOptions,
	includeTagLinks: boolean,
): { input: IndirectInput; ids: string[] } {
	const ids = model.nodes.map((n) => n.id);
	const index = new Map<string, number>();
	ids.forEach((id, i) => index.set(id, i));
	const src: number[] = [];
	const dst: number[] = [];
	for (const link of model.links) {
		if (link.kind === "tag" && !includeTagLinks) continue;
		const s = index.get(linkEndId(link.source));
		const t = index.get(linkEndId(link.target));
		if (s === undefined || t === undefined) continue;
		if (link.forward > 0) {
			src.push(s);
			dst.push(t);
		}
		if (link.backward > 0) {
			src.push(t);
			dst.push(s);
		}
	}
	return {
		input: { nodeCount: ids.length, src: Int32Array.from(src), dst: Int32Array.from(dst), options },
		ids,
	};
}

/** Turns computeIndirect output back into renderable/physics links. */
export function indirectLinksFromOutput(output: IndirectOutput, ids: string[]): GraphLink[] {
	const links: GraphLink[] = [];
	for (let i = 0; i < output.a.length; i++) {
		const source = ids[output.a[i]];
		const target = ids[output.b[i]];
		if (source === undefined || target === undefined) continue;
		links.push({
			id: `indirect:${source}\u0001${target}`,
			source,
			target,
			kind: "indirect",
			forward: 0,
			backward: 0,
			indirect: { level2: output.level2[i], level3: output.level3[i] },
		});
	}
	return links;
}
