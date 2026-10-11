import type { GraphFilters, GraphLink, GraphModel, GraphNode, LinkKind, NodeKind, SnapshotFile, VaultSnapshot } from "./types";
import { pairKey } from "./types";

export interface BuildOptions {
	filters: GraphFilters;
	/**
	 * Decides whether a file is visible (e.g. the search filter). Unresolved
	 * and tag nodes are kept only while connected to a visible file.
	 */
	includeFile?: (file: SnapshotFile) => boolean;
	/** Node objects from the previous build; reused so positions survive rebuilds. */
	previous?: Map<string, GraphNode>;
}

export const GHOST_PREFIX = "ghost:";
export const TAG_PREFIX = "tag:";

export function normalizeTag(tag: string): string {
	return tag.replace(/^#/, "").trim().toLowerCase();
}

/** Same link text from different notes should land on the same "not created yet" node. */
export function ghostId(linkText: string): string {
	return GHOST_PREFIX + linkText.replace(/\.md$/i, "").trim().toLowerCase();
}

export function ghostName(linkText: string): string {
	const clean = linkText.replace(/\.md$/i, "");
	const slash = clean.lastIndexOf("/");
	return slash >= 0 ? clean.slice(slash + 1) : clean;
}

export function tagId(tag: string): string {
	return TAG_PREFIX + normalizeTag(tag);
}

/** A note that was just created from a "not created yet" node keeps that node's position. */
function inheritGhostPosition(node: GraphNode, previous: Map<string, GraphNode>): void {
	const path = node.path ?? node.id;
	const ghost = previous.get(ghostId(path)) ?? previous.get(ghostId(path.slice(path.lastIndexOf("/") + 1)));
	if (!ghost || ghost.kind !== "unresolved") return;
	node.x = ghost.x;
	node.y = ghost.y;
	node.z = ghost.z;
}

interface DirectedEdge {
	from: string;
	to: string;
	count: number;
	kind: LinkKind;
}

/**
 * Turns a VaultSnapshot into a GraphModel:
 *  - every reference count is kept (forward/backward) so physics can weight pull by it,
 *  - unresolved links become "ghost" nodes,
 *  - A→B and B→A collapse into one link per pair carrying both counts.
 */
export function buildGraph(snapshot: VaultSnapshot, options: BuildOptions): GraphModel {
	const { filters, includeFile, previous } = options;
	const nodeById = new Map<string, GraphNode>();

	const upsert = (id: string, kind: NodeKind, name: string, extra: Partial<GraphNode> = {}): GraphNode => {
		let node = nodeById.get(id);
		if (node) return node;
		node = previous?.get(id);
		if (node) {
			node.kind = kind;
			node.name = name;
			node.path = extra.path;
			node.linkText = extra.linkText;
			node.sourcePath = extra.sourcePath;
			node.tags = extra.tags ?? [];
		} else {
			node = { id, kind, name, tags: [], ...extra, degree: 0, inRefs: 0, outRefs: 0, group: -1 };
			if (kind === "note" && previous) inheritGhostPosition(node, previous);
		}
		node.degree = 0;
		node.inRefs = 0;
		node.outRefs = 0;
		// Reused nodes keep colour/group: they are on screen until the new model is committed,
		// and only the colour stage (GraphPipeline.applyColors) may change them.
		nodeById.set(id, node);
		return node;
	};

	// 1. Visible files.
	const fileByPath = new Map<string, SnapshotFile>();
	for (const file of snapshot.files) {
		const isNote = file.extension === "md";
		if (!isNote && !filters.showAttachments) continue;
		if (includeFile && !includeFile(file)) continue;
		fileByPath.set(file.path, file);
		upsert(file.path, isNote ? "note" : "attachment", isNote ? file.basename : `${file.basename}.${file.extension}`, {
			path: file.path,
			tags: file.tags.map(normalizeTag).filter(Boolean),
		});
	}

	// 2. Directed edges with reference counts.
	const edges: DirectedEdge[] = [];
	for (const [from, targets] of Object.entries(snapshot.resolvedLinks)) {
		if (!nodeById.has(from)) continue;
		for (const [to, count] of Object.entries(targets)) {
			if (to === from || !nodeById.has(to) || count <= 0) continue;
			edges.push({ from, to, count, kind: "direct" });
		}
	}
	if (filters.showUnresolved) {
		for (const [from, targets] of Object.entries(snapshot.unresolvedLinks)) {
			if (!nodeById.has(from)) continue;
			for (const [linkText, count] of Object.entries(targets)) {
				if (count <= 0 || !linkText.trim()) continue;
				const id = ghostId(linkText);
				upsert(id, "unresolved", ghostName(linkText), { linkText, sourcePath: from });
				edges.push({ from, to: id, count, kind: "direct" });
			}
		}
	}
	if (filters.showTags) {
		for (const node of Array.from(nodeById.values())) {
			if (node.kind !== "note") continue;
			for (const tag of node.tags) {
				const id = tagId(tag);
				upsert(id, "tag", `#${tag}`);
				edges.push({ from: node.id, to: id, count: 1, kind: "tag" });
			}
		}
	}

	// 3. Collapse directions into one link per (pair, kind).
	const linkByKey = new Map<string, GraphLink>();
	for (const edge of edges) {
		const key = `${edge.kind}:${pairKey(edge.from, edge.to)}`;
		let link = linkByKey.get(key);
		if (!link) {
			link = { id: key, source: edge.from, target: edge.to, kind: edge.kind, forward: 0, backward: 0 };
			linkByKey.set(key, link);
		}
		if (link.source === edge.from) link.forward += edge.count;
		else link.backward += edge.count;
		nodeById.get(edge.from)!.outRefs += edge.count;
		nodeById.get(edge.to)!.inRefs += edge.count;
	}
	let links = Array.from(linkByKey.values());

	// 4. Neighbour sets + degree.
	const neighbors = new Map<string, Set<string>>();
	const addNeighbor = (a: string, b: string) => {
		let set = neighbors.get(a);
		if (!set) neighbors.set(a, (set = new Set()));
		set.add(b);
	};
	for (const link of links) {
		addNeighbor(link.source as string, link.target as string);
		addNeighbor(link.target as string, link.source as string);
	}

	// 5. Orphans, plus ghosts/tags stranded by the search filter.
	for (const [id, node] of Array.from(nodeById.entries())) {
		const deg = neighbors.get(id)?.size ?? 0;
		node.degree = deg;
		if (deg > 0) continue;
		if (node.kind === "unresolved" || node.kind === "tag" || !filters.showOrphans) nodeById.delete(id);
	}
	links = links.filter((l) => nodeById.has(l.source as string) && nodeById.has(l.target as string));

	const nodes = Array.from(nodeById.values());
	const stats = {
		notes: 0,
		unresolved: 0,
		attachments: 0,
		tags: 0,
		links: links.length,
		indirectLinks: 0,
	};
	for (const node of nodes) {
		if (node.kind === "note") stats.notes++;
		else if (node.kind === "unresolved") stats.unresolved++;
		else if (node.kind === "attachment") stats.attachments++;
		else stats.tags++;
	}

	return { nodes, links, extraLinks: [], nodeById, neighbors, stats };
}
