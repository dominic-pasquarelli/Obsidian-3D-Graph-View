import type { Matcher, Operator, ParsedQuery, QueryNode } from "./ast";

/**
 * Parser for the subset of Obsidian search syntax used by graph filters and
 * colour groups:
 *   words, "quoted phrases", /regex/, -negation, OR, ( grouping ),
 *   file: path: tag: content: line: section: block:, match-case: ignore-case:,
 *   [property] and [property:value].
 * Unknown operators are kept as plain text (Obsidian does the same) and reported.
 */

const OPERATORS = new Set<Operator>(["file", "path", "tag", "content", "line", "section", "block"]);
const CASE_OPS = new Set(["match-case", "ignore-case"]);
const KNOWN_UNSUPPORTED = new Set(["task", "task-todo", "task-done"]);

type Token =
	| { t: "lparen" }
	| { t: "rparen" }
	| { t: "or" }
	| { t: "not" }
	| { t: "word"; value: string; quoted: boolean }
	| { t: "regex"; source: string; flags: string }
	| { t: "op"; name: string }
	| { t: "prop"; raw: string };

function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	const n = input.length;
	const atBoundary = () => i === 0 || /[\s(:]/.test(input[i - 1]);
	while (i < n) {
		const c = input[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === "(") {
			tokens.push({ t: "lparen" });
			i++;
			continue;
		}
		if (c === ")") {
			tokens.push({ t: "rparen" });
			i++;
			continue;
		}
		if (c === "-" && atBoundary() && i + 1 < n && !/\s/.test(input[i + 1])) {
			tokens.push({ t: "not" });
			i++;
			continue;
		}
		if (c === '"') {
			let j = i + 1;
			let value = "";
			while (j < n && input[j] !== '"') {
				if (input[j] === "\\" && j + 1 < n) {
					value += input[j + 1];
					j += 2;
					continue;
				}
				value += input[j++];
			}
			tokens.push({ t: "word", value, quoted: true });
			i = j + 1;
			continue;
		}
		if (c === "/" && atBoundary()) {
			let j = i + 1;
			let source = "";
			while (j < n && input[j] !== "/") {
				if (input[j] === "\\" && j + 1 < n) {
					source += input[j] + input[j + 1];
					j += 2;
					continue;
				}
				source += input[j++];
			}
			if (j < n) {
				let k = j + 1;
				let flags = "";
				while (k < n && /[a-z]/i.test(input[k])) flags += input[k++];
				tokens.push({ t: "regex", source, flags });
				i = k;
				continue;
			}
		}
		if (c === "[") {
			let depth = 0;
			let j = i;
			for (; j < n; j++) {
				if (input[j] === "[") depth++;
				else if (input[j] === "]" && --depth === 0) break;
			}
			tokens.push({ t: "prop", raw: input.slice(i + 1, Math.min(j, n)) });
			i = j + 1;
			continue;
		}
		// bare word, possibly an operator prefix "name:"
		let j = i;
		while (j < n && !/[\s()"]/.test(input[j])) {
			if (input[j] === ":") break;
			j++;
		}
		if (j < n && input[j] === ":" && j > i) {
			tokens.push({ t: "op", name: input.slice(i, j).toLowerCase() });
			i = j + 1;
			continue;
		}
		while (j < n && !/[\s()"]/.test(input[j])) j++;
		const word = input.slice(i, j);
		tokens.push(word === "OR" ? { t: "or" } : { t: "word", value: word, quoted: false });
		i = j;
	}
	return tokens;
}

class Parser {
	private pos = 0;
	readonly warnings: string[] = [];

	constructor(private readonly tokens: Token[]) {}

	private peek(): Token | undefined {
		return this.tokens[this.pos];
	}

	parse(): QueryNode {
		if (!this.tokens.length) return { type: "all" };
		const node = this.parseOr(null, false);
		while (this.pos < this.tokens.length) {
			// stray ")" — skip it and keep going
			this.pos++;
			this.warnings.push("Unbalanced parenthesis ignored.");
		}
		return node;
	}

	private parseOr(op: Operator | null, caseSensitive: boolean): QueryNode {
		const branches: QueryNode[] = [this.parseAnd(op, caseSensitive)];
		while (this.peek()?.t === "or") {
			this.pos++;
			branches.push(this.parseAnd(op, caseSensitive));
		}
		return branches.length === 1 ? branches[0] : { type: "or", children: branches };
	}

	private parseAnd(op: Operator | null, caseSensitive: boolean): QueryNode {
		const parts: QueryNode[] = [];
		for (;;) {
			const tok = this.peek();
			if (!tok || tok.t === "or" || tok.t === "rparen") break;
			parts.push(this.parseUnary(op, caseSensitive));
		}
		if (parts.length === 0) return { type: "all" };
		return parts.length === 1 ? parts[0] : { type: "and", children: parts };
	}

	private parseUnary(op: Operator | null, caseSensitive: boolean): QueryNode {
		if (this.peek()?.t === "not") {
			this.pos++;
			return { type: "not", child: this.parseUnary(op, caseSensitive) };
		}
		return this.parsePrimary(op, caseSensitive);
	}

	private parsePrimary(op: Operator | null, caseSensitive: boolean): QueryNode {
		const tok = this.tokens[this.pos++];
		switch (tok.t) {
			case "lparen": {
				const inner = this.parseOr(op, caseSensitive);
				if (this.peek()?.t === "rparen") this.pos++;
				else this.warnings.push("Missing closing parenthesis.");
				return inner;
			}
			case "word":
				return { type: "term", op, matcher: { kind: "text", text: tok.value }, caseSensitive };
			case "regex":
				return { type: "term", op, matcher: this.regex(tok.source, tok.flags, caseSensitive), caseSensitive };
			case "prop":
				return this.property(tok.raw, caseSensitive);
			case "op":
				return this.operator(tok.name, op, caseSensitive);
			default:
				return { type: "all" };
		}
	}

	private operand(op: Operator | null, caseSensitive: boolean): QueryNode {
		const next = this.peek();
		if (!next || next.t === "or" || next.t === "rparen") return { type: "all" };
		if (next.t === "not") return this.parseUnary(op, caseSensitive);
		return this.parsePrimary(op, caseSensitive);
	}

	private operator(name: string, outerOp: Operator | null, caseSensitive: boolean): QueryNode {
		if (CASE_OPS.has(name)) return this.operand(outerOp, name === "match-case");
		if (OPERATORS.has(name as Operator)) {
			const op = name as Operator;
			const child = this.operand(op, caseSensitive);
			if ((op === "line" || op === "section" || op === "block") && child.type !== "term") {
				return { type: "scoped", op, child: retarget(child, "content") };
			}
			return child;
		}
		if (KNOWN_UNSUPPORTED.has(name)) {
			this.operand(outerOp, caseSensitive);
			this.warnings.push(`"${name}:" is not supported in graph queries and never matches.`);
			return { type: "unsupported", reason: name };
		}
		// Not an operator after all (e.g. "foo:bar") — treat as literal text like Obsidian does.
		const rest = this.peek();
		if (rest && rest.t === "word" && !rest.quoted) {
			this.pos++;
			return { type: "term", op: outerOp, matcher: { kind: "text", text: `${name}:${rest.value}` }, caseSensitive };
		}
		return { type: "term", op: outerOp, matcher: { kind: "text", text: `${name}:` }, caseSensitive };
	}

	private property(raw: string, caseSensitive: boolean): QueryNode {
		const colon = raw.indexOf(":");
		const name = (colon >= 0 ? raw.slice(0, colon) : raw).trim();
		if (colon < 0) return { type: "property", name, value: null };
		const valueText = raw.slice(colon + 1).trim();
		if (!valueText) return { type: "property", name, value: null };
		const sub = new Parser(tokenize(valueText));
		const value = sub.parseOr("content", caseSensitive);
		this.warnings.push(...sub.warnings);
		return { type: "property", name, value };
	}

	private regex(source: string, flags: string, caseSensitive: boolean): Matcher {
		try {
			const f = new Set(flags.replace(/[gy]/g, "").split(""));
			if (!caseSensitive) f.add("i");
			return { kind: "regex", regex: new RegExp(source, Array.from(f).join("")) };
		} catch {
			this.warnings.push(`Invalid regular expression /${source}/ treated as text.`);
			return { kind: "text", text: source };
		}
	}
}

/** Within line:/section:/block: scopes, bare words search content, not file names. */
function retarget(node: QueryNode, op: Operator): QueryNode {
	switch (node.type) {
		case "term":
			return node.op === null ? { ...node, op } : node;
		case "and":
		case "or":
			return { ...node, children: node.children.map((c) => retarget(c, op)) };
		case "not":
			return { ...node, child: retarget(node.child, op) };
		default:
			return node;
	}
}

export function parseQuery(input: string): ParsedQuery {
	const parser = new Parser(tokenize(input ?? ""));
	const root = parser.parse();
	return { root, warnings: parser.warnings };
}

/** True when evaluating the query may need note content (lets callers skip reading files). */
export function needsContent(node: QueryNode): boolean {
	switch (node.type) {
		case "term":
			return node.op === null || node.op === "content" || node.op === "line" || node.op === "section" || node.op === "block";
		case "scoped":
			return true;
		case "and":
		case "or":
			return node.children.some(needsContent);
		case "not":
			return needsContent(node.child);
		default:
			return false;
	}
}
