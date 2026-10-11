import type { Matcher, QueryNode } from "./ast";

/** Everything a query can look at for one node. Content is optional (lazy / unavailable). */
export interface NoteFacts {
	path: string;
	/** File name including extension (e.g. "Idea.md"); link text for unresolved notes. */
	fileName: string;
	/** Lower-case tags without "#". */
	tags: string[];
	frontmatter?: Record<string, unknown>;
	content?: string;
}

function textMatch(matcher: Matcher, haystack: string | undefined, caseSensitive: boolean): boolean {
	if (haystack === undefined) return false;
	if (matcher.kind === "regex") {
		matcher.regex.lastIndex = 0;
		return matcher.regex.test(haystack);
	}
	if (!matcher.text) return true;
	return caseSensitive ? haystack.includes(matcher.text) : haystack.toLowerCase().includes(matcher.text.toLowerCase());
}

function tagMatch(matcher: Matcher, tags: string[]): boolean {
	if (matcher.kind === "regex") return tags.some((t) => textMatch(matcher, t, false) || textMatch(matcher, `#${t}`, false));
	const want = matcher.text.replace(/^#/, "").toLowerCase();
	if (!want) return tags.length > 0;
	return tags.some((t) => t === want || t.startsWith(`${want}/`));
}

function splitUnits(content: string, op: "line" | "section" | "block"): string[] {
	if (op === "line") return content.split(/\r?\n/);
	if (op === "block") return content.split(/\r?\n\s*\r?\n/);
	return content.split(/^(?=#{1,6}\s)/m);
}

function propertyValues(frontmatter: Record<string, unknown> | undefined, name: string): unknown[] | null {
	if (!frontmatter) return null;
	const key = Object.keys(frontmatter).find((k) => k.toLowerCase() === name.toLowerCase());
	if (key === undefined) return null;
	const value = frontmatter[key];
	return Array.isArray(value) ? value : [value];
}

export function evaluate(node: QueryNode, facts: NoteFacts): boolean {
	switch (node.type) {
		case "all":
			return true;
		case "unsupported":
			return false;
		case "and":
			return node.children.every((c) => evaluate(c, facts));
		case "or":
			return node.children.some((c) => evaluate(c, facts));
		case "not":
			return !evaluate(node.child, facts);
		case "scoped": {
			if (facts.content === undefined) return false;
			return splitUnits(facts.content, node.op).some((unit) => evaluate(node.child, { ...facts, content: unit }));
		}
		case "property": {
			const values = propertyValues(facts.frontmatter, node.name);
			if (values === null) return false;
			if (!node.value) return true;
			const value = node.value;
			return values.some((v) => v !== null && v !== undefined && evaluate(value, { ...facts, content: String(v) }));
		}
		case "term": {
			const { matcher, caseSensitive } = node;
			switch (node.op) {
				case null:
					return textMatch(matcher, facts.path, caseSensitive) || textMatch(matcher, facts.content, caseSensitive);
				case "file":
					return textMatch(matcher, facts.fileName, caseSensitive);
				case "path":
					return textMatch(matcher, facts.path, caseSensitive);
				case "tag":
					return tagMatch(matcher, facts.tags);
				case "content":
					return textMatch(matcher, facts.content, caseSensitive);
				case "line":
				case "section":
				case "block":
					if (facts.content === undefined) return false;
					return splitUnits(facts.content, node.op).some((u) => textMatch(matcher, u, caseSensitive));
			}
		}
	}
	return false;
}
