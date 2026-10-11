/** AST for the supported subset of Obsidian's search syntax. */

export type Operator = "file" | "path" | "tag" | "content" | "line" | "section" | "block";

export type Matcher = { kind: "text"; text: string } | { kind: "regex"; regex: RegExp };

export type QueryNode =
	| { type: "and"; children: QueryNode[] }
	| { type: "or"; children: QueryNode[] }
	| { type: "not"; child: QueryNode }
	/** op = null → default search (file name or content). */
	| { type: "term"; op: Operator | null; matcher: Matcher; caseSensitive: boolean }
	/** [name] or [name:value] */
	| { type: "property"; name: string; value: QueryNode | null }
	/** line:(…) / section:(…) / block:(…) apply the whole sub-query to a single unit. */
	| { type: "scoped"; op: "line" | "section" | "block"; child: QueryNode }
	| { type: "all" }
	| { type: "unsupported"; reason: string };

export interface ParsedQuery {
	root: QueryNode;
	/** Human-readable notes about parts that were approximated or ignored. */
	warnings: string[];
}
