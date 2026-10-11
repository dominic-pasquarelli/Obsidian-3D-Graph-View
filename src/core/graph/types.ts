/**
 * Renderer-agnostic graph types. Nothing in here depends on Obsidian or on a
 * rendering library, so these modules can be unit-tested and reused anywhere.
 */

export type NodeKind = "note" | "unresolved" | "attachment" | "tag";

/** direct = wiki/markdown link, tag = note→tag edge, indirect = 2nd/3rd-level gravity edge. */
export type LinkKind = "direct" | "tag" | "indirect";

export interface GraphNode {
	/** Stable id: file path, `ghost:<linktext>` or `tag:<tag>`. */
	id: string;
	kind: NodeKind;
	/** Display label. */
	name: string;
	/** Vault path for notes / attachments. */
	path?: string;
	/** Original link text for unresolved ("not created yet") notes. */
	linkText?: string;
	/** For unresolved notes: a note that links to it (decides where the note is created). */
	sourcePath?: string;
	/** Lower-case tags without "#". */
	tags: string[];
	/** Distinct neighbours over direct + tag links. */
	degree: number;
	/** Total references pointing at this node (sum of per-link counts). */
	inRefs: number;
	/** Total references this node makes. */
	outRefs: number;
	/** Assigned by the colour stage; undefined = use the kind colour. */
	color?: string;
	/** Index of the first matching colour group, -1 when none. */
	group: number;

	// Simulation state (owned by the force engine; preserved across rebuilds).
	x?: number;
	y?: number;
	z?: number;
	vx?: number;
	vy?: number;
	vz?: number;
	fx?: number;
	fy?: number;
	fz?: number;
	index?: number;
}

export interface IndirectInfo {
	/** Number of 2-step paths connecting the pair (0 if level 2 did not qualify). */
	level2: number;
	/** Number of 3-step paths connecting the pair (0 if level 3 did not qualify). */
	level3: number;
}

export interface GraphLink {
	id: string;
	/** Node id before the engine resolves it, node object afterwards. */
	source: string | GraphNode;
	target: string | GraphNode;
	kind: LinkKind;
	/** References from source → target (e.g. [[B]] written 3 times in A = 3). */
	forward: number;
	/** References from target → source. */
	backward: number;
	indirect?: IndirectInfo;
	index?: number;
}

export interface SnapshotFile {
	path: string;
	/** File name without extension. */
	basename: string;
	/** Extension without dot, lower-case. */
	extension: string;
	/** Tags with or without "#", any case. */
	tags: string[];
	frontmatter?: Record<string, unknown>;
}

/**
 * Plain-data view of the vault. Produced by a data source adapter (Obsidian,
 * the dev harness mock, or anything else that can describe notes and links).
 */
export interface VaultSnapshot {
	files: SnapshotFile[];
	/** source path → target path → number of references (Obsidian's resolvedLinks shape). */
	resolvedLinks: Record<string, Record<string, number>>;
	/** source path → link text → number of references (Obsidian's unresolvedLinks shape). */
	unresolvedLinks: Record<string, Record<string, number>>;
}

export interface GraphFilters {
	showUnresolved: boolean;
	showAttachments: boolean;
	showTags: boolean;
	showOrphans: boolean;
	/** Search query limiting which files are shown (empty = all). */
	search: string;
}

export interface GraphStats {
	notes: number;
	unresolved: number;
	attachments: number;
	tags: number;
	links: number;
	indirectLinks: number;
}

export interface GraphModel {
	nodes: GraphNode[];
	/** Direct and tag links. */
	links: GraphLink[];
	/** Links contributed by augmenting modules (e.g. indirect gravity). */
	extraLinks: GraphLink[];
	nodeById: Map<string, GraphNode>;
	/** Undirected neighbour sets over `links` (used for highlighting). */
	neighbors: Map<string, Set<string>>;
	stats: GraphStats;
}

export function linkEndId(end: string | GraphNode): string {
	return typeof end === "string" ? end : end.id;
}

export function pairKey(a: string, b: string): string {
	return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
}

/** All links the renderer and physics should see. */
export function allLinks(model: GraphModel): GraphLink[] {
	return model.extraLinks.length ? model.links.concat(model.extraLinks) : model.links;
}
