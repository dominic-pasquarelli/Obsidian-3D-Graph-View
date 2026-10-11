import { compileGroups, matchGroup, type ColorGroup } from "../core/color/colorGroups";
import type { AdaptiveExecutor } from "../core/compute/executor";
import { FORCE_MODULES, type ForceSettings } from "../core/forces/registry";
import { buildGraph } from "../core/graph/GraphBuilder";
import type { GraphLink, GraphModel, GraphNode, SnapshotFile } from "../core/graph/types";
import type { PerformancePlan } from "../core/perf/scaling";
import { evaluate, needsContent, parseQuery, type NoteFacts } from "../core/query";
import type { ViewSettings } from "../core/settings/view";
import type { GraphDataSource } from "./ports";

export interface AugmentResult {
	links: GraphLink[];
	ranOn: "main" | "worker" | "cache" | "none";
	ms: number;
}

const CONTENT_BATCH = 64;

/**
 * The data side of the graph view, independent of any renderer or UI:
 *   snapshot → filtered model → colour groups → augmenting links.
 * Each stage can be re-run on its own, and expensive inputs (note content,
 * augment results) are cached.
 */
export class GraphPipeline {
	private content = new Map<string, string | null>();
	private modelVersion = 0;
	private augmentCache = new Map<string, { key: string; version: number; links: GraphLink[] }>();
	private files = new Map<string, SnapshotFile>();
	filterWarnings: string[] = [];
	colorWarnings: string[] = [];

	constructor(
		private readonly source: GraphDataSource,
		private readonly executor: AdaptiveExecutor,
	) {}

	/** Drop cached content for changed paths (null = everything). */
	invalidate(changedPaths: string[] | null): void {
		if (changedPaths === null) this.content.clear();
		else for (const p of changedPaths) this.content.delete(p);
	}

	private async loadContent(paths: string[]): Promise<void> {
		const missing = paths.filter((p) => !this.content.has(p));
		for (let i = 0; i < missing.length; i += CONTENT_BATCH) {
			const batch = missing.slice(i, i + CONTENT_BATCH);
			const texts = await Promise.all(batch.map((p) => this.source.readContent(p).catch(() => null)));
			batch.forEach((p, j) => this.content.set(p, texts[j]));
		}
	}

	private fileFacts(file: SnapshotFile): NoteFacts {
		return {
			path: file.path,
			fileName: `${file.basename}.${file.extension}`,
			tags: file.tags.map((t) => t.replace(/^#/, "").toLowerCase()),
			frontmatter: file.frontmatter,
			content: this.content.get(file.path) ?? undefined,
		};
	}

	nodeFacts(node: GraphNode): NoteFacts {
		const file = node.path ? this.files.get(node.path) : undefined;
		if (file) return this.fileFacts(file);
		if (node.kind === "tag") return { path: node.name, fileName: node.name, tags: [node.name.slice(1)] };
		const text = node.linkText ?? node.name;
		return { path: text, fileName: text, tags: [] };
	}

	async buildModel(view: ViewSettings, contentQueries: boolean, previous?: GraphModel | null): Promise<GraphModel> {
		const snapshot = this.source.snapshot();
		this.files = new Map(snapshot.files.map((f) => [f.path, f]));
		const parsed = parseQuery(view.filters.search);
		this.filterWarnings = parsed.warnings.slice();
		let includeFile: ((file: SnapshotFile) => boolean) | undefined;
		if (parsed.root.type !== "all") {
			if (needsContent(parsed.root)) {
				if (contentQueries) await this.loadContent(snapshot.files.filter((f) => f.extension === "md").map((f) => f.path));
				else this.filterWarnings.push("Content search is off in settings, so plain words only match file names.");
			}
			includeFile = (file) => evaluate(parsed.root, this.fileFacts(file));
		}
		const model = buildGraph(snapshot, { filters: view.filters, includeFile, previous: previous?.nodeById });
		this.modelVersion++;
		return model;
	}

	async applyColors(model: GraphModel, groups: ColorGroup[], contentQueries: boolean): Promise<void> {
		const compiled = compileGroups(groups);
		this.colorWarnings = compiled.flatMap((c) => c.warnings.map((w) => `${c.group.query}: ${w}`));
		if (compiled.some((c) => c.needsContent)) {
			if (contentQueries) await this.loadContent(model.nodes.filter((n) => n.kind === "note" && n.path).map((n) => n.path!));
			else this.colorWarnings.push("Content search is off in settings, so plain words only match file names.");
		}
		for (const node of model.nodes) {
			const hit = compiled.length ? matchGroup(compiled, this.nodeFacts(node)) : null;
			node.group = hit ? hit.index : -1;
			node.color = hit ? hit.group.color : undefined;
		}
	}

	async augment(model: GraphModel, forces: ForceSettings, plan: PerformancePlan): Promise<AugmentResult> {
		const started = performance.now();
		const links: GraphLink[] = [];
		let ranOn: AugmentResult["ranOn"] = "none";
		for (const module of FORCE_MODULES) {
			if (!module.augment) continue;
			const settings = forces[module.id] ?? module.defaults;
			const key = module.augmentKey ? module.augmentKey(settings) : JSON.stringify(settings);
			const cached = this.augmentCache.get(module.id);
			if (cached && cached.key === key && cached.version === this.modelVersion) {
				links.push(...cached.links);
				if (cached.links.length) ranOn = ranOn === "none" ? "cache" : ranOn;
				continue;
			}
			const produced = await module.augment(
				{
					model,
					plan,
					compute: async (task, input) => {
						const result = await this.executor.run(task, input, plan.useWorker);
						ranOn = result.ranOn;
						return result.output;
					},
				},
				settings,
			);
			this.augmentCache.set(module.id, { key, version: this.modelVersion, links: produced });
			links.push(...produced);
		}
		return { links, ranOn, ms: performance.now() - started };
	}
}
