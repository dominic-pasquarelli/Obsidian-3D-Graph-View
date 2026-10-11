import "../../styles.css";
import workerSource from "virtual:compute-worker";
import { GraphController } from "../../src/controller/GraphController";
import type { GraphDataSource, GraphHost, NodeMenuAction, SettingsStore } from "../../src/controller/ports";
import type { GraphNode } from "../../src/core/graph/types";
import { loadPluginData, serializePluginData } from "../../src/core/settings/pluginData";
import { createMockVault } from "./mockVault";

/**
 * Dev harness: runs the real GraphController against a synthetic vault in a
 * plain browser page. Query params: ?n=<notes>&mode=2d|3d&worker=always|never|auto&physics=auto|main|worker&reset=1&panel=0
 */
const params = new URLSearchParams(location.search);
const noteCount = Number(params.get("n") ?? 400);
const STORAGE_KEY = "3d-graph-view-harness";
if (params.get("reset")) localStorage.removeItem(STORAGE_KEY);

const vault = createMockVault(noteCount);
const log: { type: string; detail: unknown }[] = [];
const record = (type: string, detail: unknown) => {
	log.push({ type, detail });
	const el = document.getElementById("log");
	if (el) el.textContent = `${type}: ${JSON.stringify(detail)}`;
};

const changeListeners = new Set<(paths: string[] | null) => void>();
const source: GraphDataSource = {
	snapshot: () => vault.snapshot,
	onChange(cb) {
		changeListeners.add(cb);
		return () => changeListeners.delete(cb);
	},
	readContent: async (path) => vault.content.get(path) ?? null,
	readCoreGraphConfig: async () => vault.core,
};

const savedFiles = new Map<string, string>();
const host: GraphHost = {
	theme: () => ({ background: "#1e1e1e", text: "#dcddde", textMuted: "#8b8f98", accent: "#8b7cf6", isDark: true }),
	openNode: (node: GraphNode, newTab: boolean) => record("open", { id: node.id, kind: node.kind, newTab }),
	showNodeMenu(node: GraphNode, event: MouseEvent, actions: NodeMenuAction[]) {
		document.querySelector(".harness-menu")?.remove();
		const menu = document.createElement("div");
		menu.className = "harness-menu";
		menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;background:#2a2a2a;border:1px solid #444;border-radius:6px;padding:4px;z-index:10;`;
		for (const a of actions) {
			const item = document.createElement("div");
			item.textContent = a.title;
			item.style.cssText = "padding:4px 10px;cursor:pointer;";
			item.onclick = () => {
				menu.remove();
				a.run();
			};
			menu.append(item);
		}
		document.body.append(menu);
		setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
		record("menu", { id: node.id, actions: actions.map((a) => a.title) });
	},
	activeNodeId: () => params.get("active") ?? null,
	notify: (message) => record("notice", message),
	prompt: async (title, initial) => window.prompt(title, initial),
	confirm: async (message) => window.confirm(message),
	pickProfileFile: async () => Array.from(savedFiles.values()).pop() ?? null,
	saveProfileFile: async (kind, name, json) => {
		const path = `Graph profiles/${name}.${kind}-profile.json`;
		savedFiles.set(path, json);
		return path;
	},
};

let raw: unknown = null;
try {
	raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
} catch {
	raw = null;
}
const data = loadPluginData(raw);
const worker = params.get("worker");
if (worker === "always" || worker === "never" || worker === "auto") data.performance.workerMode = worker;
const physics = params.get("physics");
if (physics === "auto" || physics === "main" || physics === "worker") data.performance.physicsMode = physics;
const storeListeners = new Set<() => void>();
const store: SettingsStore = {
	data,
	async save() {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(serializePluginData(data)));
		for (const l of storeListeners) l();
	},
	onChange(cb) {
		storeListeners.add(cb);
		return () => storeListeners.delete(cb);
	},
};

const root = document.getElementById("app")!;
const mode = params.get("mode");
const controller = new GraphController(root, { source, host, store, workerSource }, { mode: mode === "2d" || mode === "3d" ? mode : undefined, panelOpen: params.get("panel") !== "0" });
void controller.start();

Object.assign(window, {
	harness: {
		controller,
		store,
		log,
		savedFiles,
		mutate() {
			const changed = vault.mutate();
			for (const l of changeListeners) l(changed);
		},
	},
});
