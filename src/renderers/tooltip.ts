import type { GraphNode } from "../core/graph/types";

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Small HTML tooltip shared by renderers. */
export function nodeTooltip(node: GraphNode): string {
	const kind =
		node.kind === "unresolved" ? "Not created yet" : node.kind === "attachment" ? "Attachment" : node.kind === "tag" ? "Tag" : "";
	const refs = `${node.degree} connection${node.degree === 1 ? "" : "s"} · referenced ${node.inRefs}×`;
	return `<div class="g3d-tooltip"><div class="g3d-tooltip-title">${escapeHtml(node.name)}</div>${
		kind ? `<div class="g3d-tooltip-kind">${kind}</div>` : ""
	}<div class="g3d-tooltip-meta">${refs}</div></div>`;
}
