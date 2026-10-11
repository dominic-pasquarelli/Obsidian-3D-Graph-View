import { Plugin, type WorkspaceLeaf } from "obsidian";
import { PLUGIN_NAME, VIEW_ICON, VIEW_TYPE_GRAPH } from "./constants";
import type { SettingsStore } from "./controller/ports";
import type { GraphMode } from "./core/settings/view";
import { loadPluginData, serializePluginData, type LoadedPluginData } from "./core/settings/pluginData";
import { GraphView } from "./obsidian/GraphView";
import { GraphSettingsTab } from "./obsidian/SettingsTab";

export default class GraphViewPlugin extends Plugin {
	store!: SettingsStore;

	override async onload(): Promise<void> {
		this.store = this.createStore(loadPluginData(await this.loadData()));

		this.registerView(VIEW_TYPE_GRAPH, (leaf) => new GraphView(leaf, this));
		this.registerHoverLinkSource(VIEW_TYPE_GRAPH, { display: PLUGIN_NAME, defaultMod: true });
		this.addSettingTab(new GraphSettingsTab(this.app, this));

		this.addRibbonIcon(VIEW_ICON, "Open 3D graph view", () => void this.openGraph("3d"));
		this.addCommand({ id: "open-3d", name: "Open 3D graph", callback: () => void this.openGraph("3d") });
		this.addCommand({ id: "open-2d", name: "Open 2D graph", callback: () => void this.openGraph("2d") });
		this.addCommand({
			id: "toggle-mode",
			name: "Switch between 2D and 3D",
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(GraphView);
				const controller = view?.getController();
				if (!controller) return false;
				if (!checking) controller.setMode(controller.mode() === "3d" ? "2d" : "3d");
				return true;
			},
		});
		this.addCommand({
			id: "reveal-active-note",
			name: "Show active note in graph",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) void this.revealInGraph(file.path);
				return true;
			},
		});
	}

	private createStore(data: LoadedPluginData): SettingsStore {
		const listeners = new Set<() => void>();
		return {
			data,
			save: async () => {
				await this.saveData(serializePluginData(data));
				for (const l of listeners) l();
			},
			onChange: (callback) => {
				listeners.add(callback);
				return () => listeners.delete(callback);
			},
		};
	}

	async openGraph(mode: GraphMode): Promise<WorkspaceLeaf> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: VIEW_TYPE_GRAPH, active: true, state: { mode } });
		await this.app.workspace.revealLeaf(leaf);
		return leaf;
	}

	private async revealInGraph(path: string): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPH)[0];
		if (!leaf) leaf = await this.openGraph("3d");
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view instanceof GraphView ? leaf.view : null;
		// Give a freshly opened view a moment to build its graph.
		for (let i = 0; i < 20; i++) {
			if (view?.getController()?.focusNodeById(path)) return;
			await new Promise((r) => window.setTimeout(r, 250));
		}
	}
}
