import type { CoreGraphConfig } from "../core/color/coreGraph";
import type { GraphNode, VaultSnapshot } from "../core/graph/types";
import type { ProfileKind } from "../core/profiles/ProfileLibrary";
import type { LoadedPluginData } from "../core/settings/pluginData";
import type { ResolvedTheme } from "../renderers/style";

/**
 * Ports: everything the controller needs from its environment. The Obsidian
 * plugin implements them against the vault/workspace; the dev harness
 * implements them with a fake vault. Keeping these narrow is what makes the
 * whole graph view testable outside Obsidian.
 */

export interface GraphDataSource {
	snapshot(): VaultSnapshot;
	/**
	 * Called (debounced by the source) whenever notes or links change, with the
	 * changed paths when known (null = assume everything). Returns an unsubscribe fn.
	 */
	onChange(callback: (changedPaths: string[] | null) => void): () => void;
	/** Note text for content queries; null when unavailable. */
	readContent(path: string): Promise<string | null>;
	/** The core graph's saved settings, or null if there are none. */
	readCoreGraphConfig(): Promise<CoreGraphConfig | null>;
}

export interface NodeMenuAction {
	title: string;
	icon?: string;
	run: () => void;
}

export interface GraphHost {
	theme(): ResolvedTheme;
	/** Open a note / attachment / tag search, or create a not-yet-created note. */
	openNode(node: GraphNode, newTab: boolean): void;
	showNodeMenu(node: GraphNode, event: MouseEvent, actions: NodeMenuAction[]): void;
	/**
	 * Page-preview style hover popover (optional). Called on every hover change;
	 * `node`/`event` are null when nothing is hovered (or the pointer left the graph).
	 */
	hoverPreview?(node: GraphNode | null, event: MouseEvent | null): void;
	activeNodeId(): string | null;
	notify(message: string): void;
	prompt(title: string, initial: string): Promise<string | null>;
	confirm(message: string): Promise<boolean>;
	/** Let the user pick an exported profile; resolves to its JSON text. */
	pickProfileFile(kind: ProfileKind): Promise<string | null>;
	/** Write an exported profile; resolves to where it was saved. */
	saveProfileFile(kind: ProfileKind, name: string, json: string): Promise<string>;
	/** Optional icon renderer (Obsidian's lucide icons). */
	setIcon?(el: HTMLElement, icon: string): void;
}

/** Shared, persisted plugin state (profiles + globals) used by every open graph view. */
export interface SettingsStore {
	readonly data: LoadedPluginData;
	save(): Promise<void>;
	/** Notifies views when profiles or global settings change elsewhere. */
	onChange(callback: () => void): () => void;
}

export interface ControllerDeps {
	source: GraphDataSource;
	host: GraphHost;
	store: SettingsStore;
	/** Bundled worker source, or null to always compute on the main thread. */
	workerSource: string | null;
}
