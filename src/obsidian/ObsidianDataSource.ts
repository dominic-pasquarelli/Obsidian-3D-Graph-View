import { debounce, getAllTags, normalizePath, TFile, type App, type EventRef } from "obsidian";
import { parseCoreGraphConfig, type CoreGraphConfig } from "../core/color/coreGraph";
import type { SnapshotFile, VaultSnapshot } from "../core/graph/types";
import type { GraphDataSource } from "../controller/ports";

/** Reads the vault through Obsidian's metadata cache (no file parsing of our own). */
export class ObsidianDataSource implements GraphDataSource {
	constructor(private readonly app: App) {}

	snapshot(): VaultSnapshot {
		const { vault, metadataCache } = this.app;
		const files: SnapshotFile[] = vault.getFiles().map((file) => {
			const extension = file.extension.toLowerCase();
			const cache = extension === "md" ? metadataCache.getFileCache(file) : null;
			return {
				path: file.path,
				basename: file.basename,
				extension,
				tags: cache ? (getAllTags(cache) ?? []) : [],
				frontmatter: cache?.frontmatter as Record<string, unknown> | undefined,
			};
		});
		return { files, resolvedLinks: metadataCache.resolvedLinks, unresolvedLinks: metadataCache.unresolvedLinks };
	}

	onChange(callback: (changedPaths: string[] | null) => void): () => void {
		const { vault, metadataCache } = this.app;
		const changed = new Set<string>();
		const flush = debounce(
			() => {
				const paths = Array.from(changed);
				changed.clear();
				callback(paths);
			},
			700,
			true,
		);
		const mark = (path: string) => {
			changed.add(path);
			flush();
		};
		const refs: { source: "vault" | "cache"; ref: EventRef }[] = [
			{ source: "cache", ref: metadataCache.on("changed", (file) => mark(file.path)) },
			{ source: "cache", ref: metadataCache.on("resolved", () => flush()) },
			{ source: "vault", ref: vault.on("create", (file) => mark(file.path)) },
			{ source: "vault", ref: vault.on("delete", (file) => mark(file.path)) },
			{
				source: "vault",
				ref: vault.on("rename", (file, oldPath) => {
					changed.add(oldPath);
					mark(file.path);
				}),
			},
		];
		return () => {
			flush.cancel();
			for (const { source, ref } of refs) (source === "vault" ? vault : metadataCache).offref(ref);
		};
	}

	async readContent(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? this.app.vault.cachedRead(file) : null;
	}

	async readCoreGraphConfig(): Promise<CoreGraphConfig | null> {
		const path = normalizePath(`${this.app.vault.configDir}/graph.json`);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return null;
			return parseCoreGraphConfig(JSON.parse(await this.app.vault.adapter.read(path)));
		} catch (err) {
			console.warn("[3d-graph-view] could not read core graph settings", err);
			return null;
		}
	}
}
