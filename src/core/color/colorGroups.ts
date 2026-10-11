import { evaluate, needsContent, parseQuery, type NoteFacts, type QueryNode } from "../query";
import { normalizeHex } from "../util/color";

export interface ColorGroup {
	query: string;
	/** "#rrggbb" */
	color: string;
	enabled: boolean;
}

export interface CompiledGroup {
	group: ColorGroup;
	index: number;
	root: QueryNode;
	needsContent: boolean;
	warnings: string[];
}

export function normalizeColorGroup(raw: unknown): ColorGroup | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.query !== "string") return null;
	return {
		query: r.query,
		color: typeof r.color === "string" ? normalizeHex(r.color) : "#888888",
		enabled: r.enabled !== false,
	};
}

export function compileGroups(groups: ColorGroup[]): CompiledGroup[] {
	const out: CompiledGroup[] = [];
	groups.forEach((group, index) => {
		if (!group.enabled || !group.query.trim()) return;
		const parsed = parseQuery(group.query);
		out.push({ group, index, root: parsed.root, needsContent: needsContent(parsed.root), warnings: parsed.warnings });
	});
	return out;
}

/** First matching group wins, mirroring Obsidian's graph colour groups. */
export function matchGroup(compiled: CompiledGroup[], facts: NoteFacts): CompiledGroup | null {
	for (const c of compiled) if (evaluate(c.root, facts)) return c;
	return null;
}
