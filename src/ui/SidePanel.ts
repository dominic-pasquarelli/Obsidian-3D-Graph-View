import type { ColorGroup } from "../core/color/colorGroups";
import { FORCE_MODULES, type ForceSettings } from "../core/forces/registry";
import type { ProfileKind } from "../core/profiles/ProfileLibrary";
import { VIEW_SECTIONS, type ViewSettings } from "../core/settings/view";
import type { MenuEntry } from "../controller/ports";
import { renderControls, type ControlChange, type RenderControlsOptions } from "./ControlRenderer";
import { renderColorGroupEditor } from "./ColorGroupEditor";
import { button, h, select } from "./dom";

export type ProfileAction = "save" | "saveAs" | "duplicate" | "rename" | "delete" | "revert" | "export" | "import";

/** What the side panel needs from its owner (the GraphController). */
export interface PanelContext {
	forces(): ForceSettings;
	view(): ViewSettings;
	profiles(kind: ProfileKind): { id: string; name: string }[];
	activeProfile(kind: ProfileKind): string;
	isDirty(kind: ProfileKind): boolean;
	selectProfile(kind: ProfileKind, id: string): void;
	profileAction(kind: ProfileKind, action: ProfileAction): void;
	onForceChange(moduleId: string, change: ControlChange): void;
	onViewChange(change: ControlChange): void;
	coreGroups(): ColorGroup[] | null;
	onGroupsChange(groups: ColorGroup[], final: boolean): void;
	importCoreGraph(what: "colors" | "filters" | "forces"): void;
	warnings(): { filters: string[]; colors: string[] };
	statusLines(): string[];
	showMenu(event: MouseEvent, entries: MenuEntry[]): void;
	readonly setIcon?: (el: HTMLElement, icon: string) => void;
}

/** A section of the panel: builds its body, optionally filtered by a search. Returns false if nothing matched. */
interface SectionDef {
	id: string;
	title: string;
	description?: string;
	defaultOpen: boolean;
	build(body: HTMLElement, options: RenderControlsOptions): boolean;
}

interface TabDef {
	id: string;
	label: string;
	sections(): SectionDef[];
}

const OPEN_STATE_KEY = "3d-graph-view:panel-open";
const TAB_STATE_KEY = "3d-graph-view:panel-tab";

/**
 * Settings panel: a sticky header with the profile pickers, a settings search and
 * tabs, then collapsible sections. Sections are generated from control specs, so
 * new force modules and display settings appear here automatically.
 */
export class SidePanel {
	readonly el: HTMLElement;
	private headEl = h("div", { class: "g3d-panel-head" });
	private tabsEl = h("div", { class: "g3d-tabs", role: "tablist" });
	private bodyEl = h("div", { class: "g3d-panel-body" });
	private searchEl: HTMLInputElement;
	private open: Record<string, boolean>;
	private tab: string;
	private query = "";
	private readonly tabs: TabDef[];

	constructor(private readonly ctx: PanelContext) {
		this.el = h("div", { class: "g3d-panel" });
		this.open = loadState<Record<string, boolean>>(OPEN_STATE_KEY, {});
		this.tabs = this.defineTabs();
		const savedTab = loadState<string>(TAB_STATE_KEY, "forces");
		this.tab = this.tabs.some((t) => t.id === savedTab) ? savedTab : this.tabs[0].id;

		this.searchEl = h("input", { type: "search", class: "g3d-settings-search", placeholder: "Search settings…", spellcheck: "false", "aria-label": "Search settings" });
		this.searchEl.addEventListener("input", () => {
			this.query = this.searchEl.value.trim().toLowerCase();
			this.renderTabs();
			this.renderBody();
		});
		this.searchEl.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && this.searchEl.value) {
				e.stopPropagation();
				this.searchEl.value = "";
				this.query = "";
				this.renderTabs();
				this.renderBody();
			}
		});
		this.headEl.append(h("div", { class: "g3d-profiles", "data-section": "profiles" }), this.searchEl, this.tabsEl);
		this.el.append(this.headEl, this.bodyEl);
	}

	render(): void {
		this.renderProfiles();
		this.renderTabs();
		this.renderBody();
	}

	/** Re-render one section (used after edits that change visibility). Hidden sections render when shown. */
	renderSection(id: string): void {
		if (id === "profiles") return this.renderProfiles();
		const old = this.bodyEl.querySelector(`[data-section="${CSS.escape(id)}"]`);
		const def = this.tabs.flatMap((t) => t.sections()).find((s) => s.id === id);
		if (!old || !def) return;
		const fresh = this.section(def);
		if (fresh) old.replaceWith(fresh);
		else old.remove();
	}

	// ------------------------------------------------------------ profiles

	private renderProfiles(): void {
		const el = this.headEl.querySelector<HTMLElement>('[data-section="profiles"]')!;
		el.replaceChildren(this.profileRow("force", "Forces"), this.profileRow("view", "View"));
	}

	private profileRow(kind: ProfileKind, label: string): HTMLElement {
		const ctx = this.ctx;
		const dirty = ctx.isDirty(kind);
		const profiles = ctx.profiles(kind);
		const picker = select(
			profiles.map((p) => ({ value: p.id, label: p.name })),
			ctx.activeProfile(kind),
			(id) => ctx.selectProfile(kind, id),
			"g3d-select g3d-profile-select",
		);
		picker.title = `${label} profile`;
		const save = button("Save", () => ctx.profileAction(kind, "save"), {
			title: dirty ? `Save changes to this ${kind} profile` : "No unsaved changes",
			cls: dirty ? "mod-cta" : "",
		});
		save.disabled = !dirty;
		const more = this.iconButton("More", "more-horizontal", `More ${kind} profile actions`, (e) =>
			ctx.showMenu(e, [
				{ title: "Save as new profile…", icon: "copy-plus", run: () => ctx.profileAction(kind, "saveAs") },
				{ title: "Duplicate", icon: "copy", disabled: dirty, run: () => ctx.profileAction(kind, "duplicate") },
				{ title: "Rename…", icon: "pencil", run: () => ctx.profileAction(kind, "rename") },
				{ title: "Revert changes", icon: "undo-2", disabled: !dirty, run: () => ctx.profileAction(kind, "revert") },
				"separator",
				{ title: "Export to vault…", icon: "upload", run: () => ctx.profileAction(kind, "export") },
				{ title: "Import from vault…", icon: "download", run: () => ctx.profileAction(kind, "import") },
				"separator",
				{ title: "Delete profile", icon: "trash-2", warning: true, disabled: profiles.length <= 1, run: () => ctx.profileAction(kind, "delete") },
			]),
		);
		const row = h("div", { class: "g3d-profile", "data-kind": kind }, [
			h("div", { class: "g3d-profile-row" }, [h("span", { class: "g3d-profile-label" }, [label]), picker, save, more]),
		]);
		if (dirty) {
			const revert = h("a", { class: "g3d-link", href: "#" }, ["Revert"]);
			revert.addEventListener("click", (e) => {
				e.preventDefault();
				ctx.profileAction(kind, "revert");
			});
			row.append(h("div", { class: "g3d-dirty" }, ["Unsaved changes · ", revert]));
		}
		return row;
	}

	// ------------------------------------------------------------ tabs + body

	private renderTabs(): void {
		this.tabsEl.classList.toggle("is-searching", this.query.length > 0);
		this.tabsEl.replaceChildren(
			...this.tabs.map((t) => {
				const b = button(t.label, () => {
					this.tab = t.id;
					saveState(TAB_STATE_KEY, t.id);
					if (this.query) {
						this.searchEl.value = "";
						this.query = "";
					}
					this.renderTabs();
					this.renderBody();
					this.bodyEl.scrollTop = 0;
				});
				b.className = "g3d-tab";
				b.setAttribute("role", "tab");
				b.setAttribute("aria-selected", String(!this.query && t.id === this.tab));
				b.classList.toggle("is-active", !this.query && t.id === this.tab);
				b.dataset.tab = t.id;
				return b;
			}),
		);
	}

	private renderBody(): void {
		const scroll = this.bodyEl.scrollTop;
		this.bodyEl.replaceChildren();
		if (this.query) {
			let any = false;
			for (const tab of this.tabs) {
				const sections = tab.sections().map((s) => this.section(s)).filter((s): s is HTMLElement => s !== null);
				if (!sections.length) continue;
				any = true;
				this.bodyEl.append(h("div", { class: "g3d-panel-title" }, [tab.label]), ...sections);
			}
			if (!any) this.bodyEl.append(h("div", { class: "g3d-muted g3d-empty" }, [`No settings match “${this.searchEl.value.trim()}”.`]));
			return;
		}
		const tab = this.tabs.find((t) => t.id === this.tab) ?? this.tabs[0];
		for (const def of tab.sections()) {
			const el = this.section(def);
			if (el) this.bodyEl.append(el);
		}
		this.bodyEl.scrollTop = scroll;
	}

	/** Builds a collapsible section, or null when a search leaves it empty. */
	private section(def: SectionDef): HTMLElement | null {
		const searching = this.query.length > 0;
		const titleMatch = searching && matches(this.query, def.title, def.description);
		const options: RenderControlsOptions = searching && !titleMatch ? { filter: (spec) => matches(this.query, spec.label, spec.desc, spec.key) } : {};
		const content = h("div", { class: "g3d-section-body" });
		if (def.description && !options.filter) content.append(h("div", { class: "g3d-section-desc" }, [def.description]));
		const found = def.build(content, options);
		if (searching && !found && !titleMatch) return null;

		const el = h("details", { class: "g3d-section", "data-section": def.id });
		const details = el as HTMLDetailsElement;
		details.open = searching || (this.open[def.id] ?? def.defaultOpen);
		el.addEventListener("toggle", () => {
			if (this.query) return; // search results are always expanded; don't remember that
			this.open[def.id] = details.open;
			saveState(OPEN_STATE_KEY, this.open);
		});
		el.append(h("summary", {}, [def.title]), content);
		return el;
	}

	private defineTabs(): TabDef[] {
		const view = (id: string) => this.viewSection(id);
		return [
			{ id: "filters", label: "Filters", sections: () => [view("filters")] },
			{
				id: "forces",
				label: "Forces",
				sections: () => [...FORCE_MODULES.map((m) => this.forceSection(m.id)), this.coreForcesSection()],
			},
			{
				id: "display",
				label: "Display",
				sections: () => VIEW_SECTIONS.filter((s) => s.id !== "filters").map((s) => view(s.id)),
			},
			{ id: "colors", label: "Colours", sections: () => [this.colorsSection()] },
			{ id: "info", label: "Info", sections: () => [this.navigationSection(), this.statusSection()] },
		];
	}

	// ------------------------------------------------------------ sections

	private forceSection(moduleId: string): SectionDef {
		const module = FORCE_MODULES.find((m) => m.id === moduleId)!;
		const id = `force:${moduleId}`;
		return {
			id,
			title: module.label,
			description: module.description,
			defaultOpen: moduleId === "links",
			build: (body, options) =>
				renderControls(
					body,
					module.controls,
					this.ctx.forces()[moduleId],
					(change) => {
						this.ctx.onForceChange(moduleId, change);
						if (change.final) this.renderSection(id);
					},
					options,
				) > 0,
		};
	}

	private coreForcesSection(): SectionDef {
		return {
			id: "force:core",
			title: "Start from the core graph",
			defaultOpen: false,
			build: (body, options) => {
				if (options.filter) return false;
				body.append(
					h("div", { class: "g3d-section-desc" }, ["Approximate the core graph's force sliders in this force profile."]),
					button("Import core graph forces", () => this.ctx.importCoreGraph("forces")),
				);
				return true;
			},
		};
	}

	private viewSection(sectionId: string): SectionDef {
		const section = VIEW_SECTIONS.find((s) => s.id === sectionId)!;
		const id = `view:${sectionId}`;
		return {
			id,
			title: section.label,
			defaultOpen: true,
			build: (body, options) => {
				const count = renderControls(
					body,
					section.controls,
					this.ctx.view(),
					(change) => {
						this.ctx.onViewChange(change);
						if (change.final) this.renderSection(id);
					},
					options,
				);
				if (sectionId === "filters" && !options.filter) {
					warningsList(body, this.ctx.warnings().filters);
					body.append(
						h("div", { class: "g3d-inline-actions" }, [
							button("Import core graph filters", () => this.ctx.importCoreGraph("filters"), {
								title: "Copy search, tags, attachments, orphans and arrows settings from the core graph",
							}),
						]),
					);
				}
				return count > 0;
			},
		};
	}

	private colorsSection(): SectionDef {
		return {
			id: "colors",
			title: "Colour groups",
			description: "Colour notes by search queries (tag:, path:, file:, [property:value], words…). The first matching group wins.",
			defaultOpen: true,
			build: (body, options) => {
				const view = this.ctx.view();
				const core = this.ctx.coreGroups();
				const count = renderControls(
					body,
					[
						{
							type: "toggle",
							key: "colors.useCoreGroups",
							label: "Use core graph colour groups (live)",
							desc: core ? `${core.length} group(s) found in the core graph.` : "No core graph settings found.",
						},
					],
					view,
					(change) => {
						this.ctx.onViewChange(change);
						this.renderSection("colors");
					},
					options,
				);
				if (options.filter) return count > 0;
				const live = view.colors.useCoreGroups;
				renderColorGroupEditor(body, {
					groups: live ? (core ?? []) : view.colors.groups,
					readOnly: live,
					onChange: (groups, final) => this.ctx.onGroupsChange(groups, final),
				});
				if (live) body.append(h("div", { class: "g3d-muted" }, ["Turn off live mode to edit your own groups."]));
				warningsList(body, this.ctx.warnings().colors);
				body.append(
					h("div", { class: "g3d-inline-actions" }, [
						button("Copy core graph groups", () => this.ctx.importCoreGraph("colors"), {
							title: "Copy the core graph's colour groups into this view profile so you can edit them",
						}),
					]),
				);
				return true;
			},
		};
	}

	private navigationSection(): SectionDef {
		const rows: [string, string][] = [
			["3D", "Left-drag to rotate · scroll to zoom · right-drag to pan (camera style: Display › Interaction)"],
			["2D", "Drag the background to pan · scroll to zoom"],
			["Click", "Open the note · Ctrl/Cmd-click opens a new tab · uncreated notes are created"],
			["Drag", "Move a node (it stays put if “Pin nodes after dragging” is on)"],
			["Right-click", "Focus, pin / unpin, open in a new tab"],
			["Hover", "Highlights neighbours · hold Ctrl/Cmd for a page preview"],
		];
		return {
			id: "info:navigation",
			title: "Navigation",
			defaultOpen: true,
			build: (body, options) => {
				const shown = rows.filter(([term, text]) => !options.filter || options.filter({ label: term, desc: text }));
				const list = h("dl", { class: "g3d-help" });
				for (const [term, text] of shown) list.append(h("dt", {}, [term]), h("dd", {}, [text]));
				body.append(list);
				return shown.length > 0;
			},
		};
	}

	private statusSection(): SectionDef {
		return {
			id: "status",
			title: "Graph info",
			defaultOpen: true,
			build: (body, options) => {
				const lines = this.ctx.statusLines().filter((line) => !options.filter || options.filter({ label: line }));
				for (const line of lines) body.append(h("div", { class: "g3d-status-line" }, [line]));
				return lines.length > 0;
			},
		};
	}

	private iconButton(label: string, icon: string, title: string, run: (e: MouseEvent) => void): HTMLButtonElement {
		const b = button(label, run, { title, cls: "g3d-icon-btn" });
		if (this.ctx.setIcon) {
			b.replaceChildren();
			this.ctx.setIcon(b, icon);
		} else {
			b.textContent = "⋯";
		}
		return b;
	}
}

function matches(query: string, ...texts: (string | undefined)[]): boolean {
	const words = query.split(/\s+/).filter(Boolean);
	const haystack = texts.filter(Boolean).join(" ").toLowerCase();
	return words.every((w) => haystack.includes(w));
}

function warningsList(parent: HTMLElement, warnings: string[]): void {
	if (!warnings.length) return;
	const list = h("ul", { class: "g3d-warnings" });
	for (const w of warnings) list.append(h("li", {}, [w]));
	parent.append(list);
}

function loadState<T>(key: string, fallback: T): T {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

function saveState(key: string, value: unknown): void {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		/* storage unavailable — fine */
	}
}
