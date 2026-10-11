import type { CoreGraphConfig } from "../../src/core/color/coreGraph";
import { CORE_GRAPH_DEFAULTS } from "../../src/core/color/coreGraph";
import type { SnapshotFile, VaultSnapshot } from "../../src/core/graph/types";

/** Deterministic PRNG so harness runs are reproducible. */
function rng(seed: number) {
	return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const TOPICS = ["neuro", "memory", "recall", "design", "systems", "music", "physics", "writing"];

export interface MockVault {
	snapshot: VaultSnapshot;
	content: Map<string, string>;
	core: CoreGraphConfig;
	/** Adds a few random links (simulates editing). Returns changed paths. */
	mutate(): string[];
}

/**
 * A synthetic vault with topic clusters, repeated references, notes that
 * don't exist yet, tags, frontmatter and a hub "index" note.
 */
export function createMockVault(noteCount: number, seed = 7): MockVault {
	const rand = rng(seed);
	const files: SnapshotFile[] = [];
	const resolvedLinks: Record<string, Record<string, number>> = {};
	const unresolvedLinks: Record<string, Record<string, number>> = {};
	const content = new Map<string, string>();
	const byTopic = new Map<string, string[]>();

	for (let i = 0; i < noteCount; i++) {
		const topic = TOPICS[i % TOPICS.length];
		const path = `${topic}/${topic}-${i}.md`;
		const tags = [`#${topic}`];
		if (rand() < 0.2) tags.push("#status/active");
		files.push({ path, basename: `${topic}-${i}`, extension: "md", tags, frontmatter: { status: rand() < 0.5 ? "draft" : "done", topic } });
		content.set(path, `# ${topic} ${i}\nSome thoughts about ${topic}.\n${rand() < 0.1 ? "spaced repetition helps recall" : ""}`);
		(byTopic.get(topic) ?? byTopic.set(topic, []).get(topic)!).push(path);
	}
	const index = "Index.md";
	files.push({ path: index, basename: "Index", extension: "md", tags: ["#moc"] });
	files.push({ path: "assets/diagram.png", basename: "diagram", extension: "png", tags: [] });
	content.set(index, "# Index");

	const link = (from: string, to: string, count = 1) => {
		const row = (resolvedLinks[from] ??= {});
		row[to] = (row[to] ?? 0) + count;
	};
	for (const file of files) {
		if (file.extension !== "md" || file.path === index) continue;
		const topic = file.path.split("/")[0];
		const peers = byTopic.get(topic)!;
		const n = 1 + Math.floor(rand() * 3);
		for (let k = 0; k < n; k++) {
			const target = rand() < 0.85 ? peers[Math.floor(rand() * peers.length)] : files[Math.floor(rand() * noteCount)].path;
			if (target !== file.path) link(file.path, target, rand() < 0.2 ? 2 + Math.floor(rand() * 6) : 1);
		}
		if (rand() < 0.15) {
			const ghost = `Idea about ${TOPICS[Math.floor(rand() * TOPICS.length)]}`;
			(unresolvedLinks[file.path] ??= {})[ghost] = 1 + Math.floor(rand() * 3);
		}
		if (rand() < 0.03) link(file.path, "assets/diagram.png");
	}
	for (const topic of TOPICS) link(index, byTopic.get(topic)![0], 1);
	for (const file of files) {
		resolvedLinks[file.path] ??= {};
		unresolvedLinks[file.path] ??= {};
	}

	const core: CoreGraphConfig = {
		...CORE_GRAPH_DEFAULTS,
		colorGroups: [
			{ query: "tag:#neuro OR tag:#memory", color: "#e05c97", enabled: true },
			{ query: "path:recall", color: "#4fb6e8", enabled: true },
			{ query: "tag:#design", color: "#f2b84b", enabled: true },
			{ query: "[status:done] tag:#systems", color: "#58c27d", enabled: true },
		],
	};

	return {
		snapshot: { files, resolvedLinks, unresolvedLinks },
		content,
		core,
		mutate() {
			const a = files[Math.floor(rand() * noteCount)].path;
			const b = files[Math.floor(rand() * noteCount)].path;
			link(a, b, 3);
			return [a];
		},
	};
}
