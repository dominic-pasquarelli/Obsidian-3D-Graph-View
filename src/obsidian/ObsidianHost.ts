import { Menu, normalizePath, Notice, setIcon, TFile, TFolder, type App, type HoverParent } from "obsidian";
import { VIEW_TYPE_GRAPH } from "../constants";
import type { GraphHost, NodeMenuAction } from "../controller/ports";
import type { GraphNode } from "../core/graph/types";
import type { ProfileKind } from "../core/profiles/ProfileLibrary";
import { cssColorToHex } from "../core/util/color";
import type { ResolvedTheme } from "../renderers/style";
import { confirmAction, pickFile, promptText } from "./modals";

interface InternalPlugins {
	internalPlugins?: { getPluginById?(id: string): { instance?: { openGlobalSearch?(query: string): void } } | null };
}

/** Workspace-facing actions for the graph view (opening notes, menus, modals, theme). */
export class ObsidianHost implements GraphHost {
	constructor(
		private readonly app: App,
		private readonly hoverParent: HoverParent,
		private readonly profileFolder: () => string,
	) {}

	theme(): ResolvedTheme {
		const probe = document.body.createDiv();
		probe.style.display = "none";
		const read = (cssVar: string, fallback: string) => {
			probe.style.color = `var(${cssVar})`;
			return cssColorToHex(getComputedStyle(probe).color, fallback);
		};
		const isDark = document.body.classList.contains("theme-dark");
		const theme: ResolvedTheme = {
			background: read("--background-primary", isDark ? "#1e1e1e" : "#ffffff"),
			text: read("--text-normal", isDark ? "#dcddde" : "#2e3338"),
			textMuted: read("--text-muted", isDark ? "#999999" : "#888888"),
			accent: read("--interactive-accent", "#7f6df2"),
			isDark,
		};
		probe.remove();
		return theme;
	}

	openNode(node: GraphNode, newTab: boolean): void {
		const workspace = this.app.workspace;
		if (node.kind === "tag") {
			const search = (this.app as unknown as InternalPlugins).internalPlugins?.getPluginById?.("global-search")?.instance;
			if (search?.openGlobalSearch) search.openGlobalSearch(`tag:${node.name}`);
			else new Notice(`Search for ${node.name}`);
			return;
		}
		if (node.kind === "unresolved") {
			// openLinkText creates the note (respecting "Default location for new notes").
			void workspace.openLinkText(node.linkText ?? node.name, node.sourcePath ?? "", newTab ? "tab" : false);
			return;
		}
		const file = node.path ? this.app.vault.getAbstractFileByPath(node.path) : null;
		if (file instanceof TFile) void workspace.getLeaf(newTab ? "tab" : false).openFile(file);
	}

	showNodeMenu(node: GraphNode, event: MouseEvent, actions: NodeMenuAction[]): void {
		const menu = new Menu();
		for (const action of actions) {
			menu.addItem((item) => {
				item.setTitle(action.title).onClick(action.run);
				if (action.icon) item.setIcon(action.icon);
			});
		}
		const file = node.path ? this.app.vault.getAbstractFileByPath(node.path) : null;
		if (file instanceof TFile) {
			menu.addSeparator();
			// Let other plugins add their file actions (same as the core graph).
			this.app.workspace.trigger("file-menu", menu, file, VIEW_TYPE_GRAPH);
		}
		menu.showAtMouseEvent(event);
	}

	hoverPreview(node: GraphNode, event: MouseEvent, target: HTMLElement): void {
		if (!node.path || node.kind !== "note") return;
		this.app.workspace.trigger("hover-link", {
			event,
			source: VIEW_TYPE_GRAPH,
			hoverParent: this.hoverParent,
			targetEl: target,
			linktext: node.path,
			sourcePath: "",
		});
	}

	activeNodeId(): string | null {
		return this.app.workspace.getActiveFile()?.path ?? null;
	}

	notify(message: string): void {
		new Notice(message);
	}

	prompt(title: string, initial: string): Promise<string | null> {
		return promptText(this.app, title, initial);
	}

	confirm(message: string): Promise<boolean> {
		return confirmAction(this.app, message);
	}

	async pickProfileFile(kind: ProfileKind): Promise<string | null> {
		const folder = normalizePath(this.profileFolder());
		const files = this.app.vault.getFiles().filter((f) => f.extension === "json" && (folder === "/" || f.path.startsWith(`${folder}/`)));
		if (files.length === 0) {
			new Notice(`No profile files (.json) found in "${folder}". Export a profile first, or change the folder in settings.`);
			return null;
		}
		const file = await pickFile(this.app, files, `Choose a ${kind} profile to import`);
		return file ? this.app.vault.read(file) : null;
	}

	async saveProfileFile(kind: ProfileKind, name: string, json: string): Promise<string> {
		const folder = normalizePath(this.profileFolder());
		if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
		const safe = name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "profile";
		const path = normalizePath(`${folder}/${safe}.${kind}-profile.json`);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) await this.app.vault.modify(existing, json);
		else await this.app.vault.create(path, json);
		return path;
	}

	setIcon(el: HTMLElement, icon: string): void {
		setIcon(el, icon);
	}
}
