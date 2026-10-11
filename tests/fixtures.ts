import type { GraphFilters, SnapshotFile, VaultSnapshot } from "../src/core/graph/types";

export function file(path: string, tags: string[] = [], frontmatter?: Record<string, unknown>): SnapshotFile {
	const name = path.split("/").pop()!;
	const dot = name.lastIndexOf(".");
	return { path, basename: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase(), tags, frontmatter };
}

export const ALL_FILTERS: GraphFilters = {
	showUnresolved: true,
	showAttachments: true,
	showTags: false,
	showOrphans: true,
	search: "",
};

/**
 * A.md links to B three times and to the not-yet-created "Idea" twice.
 * B.md links back to A once and embeds img.png. C.md is an orphan. D.md links to "idea" (case differs).
 */
export function sampleVault(): VaultSnapshot {
	return {
		files: [
			file("A.md", ["#project"]),
			file("folder/B.md", ["#project/sub", "#reading"]),
			file("C.md"),
			file("D.md"),
			file("img.png"),
		],
		resolvedLinks: {
			"A.md": { "folder/B.md": 3 },
			"folder/B.md": { "A.md": 1, "img.png": 1 },
			"C.md": {},
			"D.md": {},
		},
		unresolvedLinks: {
			"A.md": { Idea: 2 },
			"D.md": { idea: 1 },
		},
	};
}
