import { describe, expect, it } from "vitest";
import { evaluate, needsContent, parseQuery, type NoteFacts } from "../src/core/query";

const note: NoteFacts = {
	path: "Projects/Neural Maps.md",
	fileName: "Neural Maps.md",
	tags: ["project", "project/active", "idea"],
	frontmatter: { status: "Draft", aliases: ["brain map", "mind"] },
	content: "# Intro\nGraphs are fun.\nRecall uses spaced repetition.\n\n# Next\nTODO write more",
};

const q = (query: string, facts: NoteFacts = note) => evaluate(parseQuery(query).root, facts);

describe("query language", () => {
	it("matches everything for an empty query", () => {
		expect(q("")).toBe(true);
	});

	it("supports path:, file: and tag: (with nesting)", () => {
		expect(q("path:Projects")).toBe(true);
		expect(q("path:Archive")).toBe(false);
		expect(q("file:neural")).toBe(true);
		expect(q('file:"Neural Maps"')).toBe(true);
		expect(q("tag:#project")).toBe(true);
		expect(q("tag:project/active")).toBe(true);
		expect(q("tag:proj")).toBe(false);
		expect(q("tag:#reading")).toBe(false);
	});

	it("supports AND, OR, negation and grouping", () => {
		expect(q("tag:#idea path:Projects")).toBe(true);
		expect(q("tag:#idea path:Archive")).toBe(false);
		expect(q("tag:#reading OR path:Projects")).toBe(true);
		expect(q("-path:Archive")).toBe(true);
		expect(q("-tag:#idea")).toBe(false);
		expect(q("path:(Archive OR Projects)")).toBe(true);
		expect(q("(tag:#reading OR tag:#idea) -file:Old")).toBe(true);
	});

	it("searches file name and content for plain words", () => {
		expect(q("spaced")).toBe(true);
		expect(q("neural")).toBe(true);
		expect(q('"spaced repetition"')).toBe(true);
		expect(q("missingword")).toBe(false);
		expect(q("spaced", { ...note, content: undefined })).toBe(false);
	});

	it("supports content:, line: and section:", () => {
		expect(q("content:Graphs")).toBe(true);
		expect(q("line:(recall repetition)")).toBe(true);
		expect(q("line:(graphs repetition)")).toBe(false);
		expect(q("section:(intro recall)")).toBe(true);
		expect(q("section:(intro TODO)")).toBe(false);
	});

	it("supports properties", () => {
		expect(q("[status]")).toBe(true);
		expect(q("[status:draft]")).toBe(true);
		expect(q("[status:done]")).toBe(false);
		expect(q("[aliases:brain]")).toBe(true);
		expect(q("[missing]")).toBe(false);
	});

	it("supports Obsidian's quoted property syntax", () => {
		const person: NoteFacts = { path: "People/Ada.md", fileName: "Ada.md", tags: [], frontmatter: { type: "People", Classification: "[[Meeting]]", "due date": "2026-01-02" } };
		expect(q('["type":"People"]', person)).toBe(true);
		expect(q('["type":"Places"]', person)).toBe(false);
		expect(q('["Classification":"Meeting"]', person)).toBe(true);
		expect(q('["classification"]', person)).toBe(true);
		expect(q('["due date":"2026-01-02"]', person)).toBe(true);
		expect(q('[type:"People"]', person)).toBe(true);
		expect(q('["type":People OR Places]', person)).toBe(true);
	});

	it("supports regex and case operators", () => {
		expect(q("path:/^Projects\\//")).toBe(true);
		expect(q("/repet+ition/")).toBe(true);
		expect(q("match-case:graphs")).toBe(false);
		expect(q("match-case:Graphs")).toBe(true);
	});

	it("reports unsupported operators and never matches them", () => {
		const parsed = parseQuery("task:write");
		expect(parsed.warnings.length).toBeGreaterThan(0);
		expect(evaluate(parsed.root, note)).toBe(false);
	});

	it("knows when content is needed", () => {
		expect(needsContent(parseQuery("tag:#a path:b").root)).toBe(false);
		expect(needsContent(parseQuery("tag:#a word").root)).toBe(true);
		expect(needsContent(parseQuery("line:(a b)").root)).toBe(true);
	});

	it("survives malformed input", () => {
		expect(() => parseQuery('path:( "unterminated')).not.toThrow();
		expect(() => parseQuery("))(( OR -")).not.toThrow();
		expect(() => parseQuery("/[unclosed/")).not.toThrow();
	});
});
