import type { ColorGroup } from "../core/color/colorGroups";
import { FORCE_MODULES, type ForceSettings } from "../core/forces/registry";
import type { ProfileKind } from "../core/profiles/ProfileLibrary";
import { VIEW_SECTIONS, type ViewSettings } from "../core/settings/view";
import { renderControls, type ControlChange } from "./ControlRenderer";
import { renderColorGroupEditor } from "./ColorGroupEditor";
import { button, h, select } from "./dom";

export type ProfileAction = "save" | "saveAs" | "rename" | "delete" | "revert" | "export" | "import";

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
}

const OPEN_STATE_KEY = "3d-graph-view:panel-open";

/**
 * Collapsible settings panel. Every section is generated from control specs,
 * so new force modules and display settings appear here automatically.
 */
export class SidePanel {
	readonly el: HTMLElement;
	private open: Record<string, boolean>;

	constructor(private readonly ctx: PanelContext) {
		this.el = h("div", { class: "g3d-panel" });
		this.open = loadOpenState();
	}

	render(): void {
		const scroll = this.el.scrollTop;
		this.el.replaceChildren();
		this.el.append(this.profilesSection());
		this.el.append(h("div", { class: "g3d-panel-title" }, ["Forces"]));
		for (const module of FORCE_MODULES) this.el.append(this.forceSection(module.id));
		this.el.append(h("div", { class: "g3d-panel-title" }, ["Display"]));
		for (const section of VIEW_SECTIONS) this.el.append(this.viewSection(section.id));
		this.el.append(this.colorsSection());
		this.el.append(this.statusSection());
		this.el.scrollTop = scroll;
	}

	/** Re-render only one section (used after edits that change visibility). */
	renderSection(id: string): void {
		const old = this.el.querySelector(`[data-section="${CSS.escape(id)}"]`);
		if (!old) return this.render();
		const fresh =
			id === "profiles"
				? this.profilesSection()
				: id === "colors"
					? this.colorsSection()
					: id === "status"
						? this.statusSection()
						: id.startsWith("force:")
							? this.forceSection(id.slice(6))
							: this.viewSection(id.slice(5));
		old.replaceWith(fresh);
	}

	private details(id: string, title: string, defaultOpen: boolean, body: (el: HTMLElement) => void, description?: string): HTMLElement {
		const el = h("details", { class: "g3d-section", "data-section": id });
		(el as HTMLDetailsElement).open = this.open[id] ?? defaultOpen;
		el.addEventListener("toggle", () => {
			this.open[id] = (el as HTMLDetailsElement).open;
			saveOpenState(this.open);
		});
		el.append(h("summary", {}, [title]));
		const content = h("div", { class: "g3d-section-body" });
		if (description) content.append(h("div", { class: "g3d-section-desc" }, [description]));
		body(content);
		el.append(content);
		return el;
	}

	private profilesSection(): HTMLElement {
		return this.details("profiles", "Profiles", true, (body) => {
			for (const kind of ["force", "view"] as const) {
				const label = kind === "force" ? "Force profile" : "View profile";
				const options = this.ctx.profiles(kind).map((p) => ({ value: p.id, label: p.name }));
				const row = h("div", { class: "g3d-profile-row" }, [
					h("div", { class: "g3d-ctl-label" }, [label, this.ctx.isDirty(kind) ? h("span", { class: "g3d-dirty", title: "Unsaved changes" }, [" •"]) : null]),
					select(options, this.ctx.activeProfile(kind), (id) => this.ctx.selectProfile(kind, id)),
				]);
				const actions = h("div", { class: "g3d-profile-actions" }, [
					button("Save", () => this.ctx.profileAction(kind, "save"), { title: `Save changes to this ${kind} profile`, cls: this.ctx.isDirty(kind) ? "mod-cta" : "" }),
					button("Save as…", () => this.ctx.profileAction(kind, "saveAs"), { title: "Save as a new profile" }),
					button("Revert", () => this.ctx.profileAction(kind, "revert"), { title: "Discard unsaved changes" }),
					button("Rename", () => this.ctx.profileAction(kind, "rename")),
					button("Delete", () => this.ctx.profileAction(kind, "delete"), { cls: "mod-warning" }),
					button("Export", () => this.ctx.profileAction(kind, "export"), { title: "Write this profile to a JSON file in your vault" }),
					button("Import", () => this.ctx.profileAction(kind, "import"), { title: "Load a profile JSON file from your vault" }),
				]);
				body.append(h("div", { class: "g3d-profile" }, [row, actions]));
			}
		});
	}

	private forceSection(moduleId: string): HTMLElement {
		const module = FORCE_MODULES.find((m) => m.id === moduleId)!;
		const id = `force:${moduleId}`;
		return this.details(
			id,
			module.label,
			moduleId === "links",
			(body) => {
				const settings = this.ctx.forces()[moduleId];
				renderControls(body, module.controls, settings, (change) => {
					this.ctx.onForceChange(moduleId, change);
					if (change.final) this.renderSection(id);
				});
			},
			module.description,
		);
	}

	private viewSection(sectionId: string): HTMLElement {
		const section = VIEW_SECTIONS.find((s) => s.id === sectionId)!;
		const id = `view:${sectionId}`;
		return this.details(id, section.label, sectionId === "filters", (body) => {
			renderControls(body, section.controls, this.ctx.view(), (change) => {
				this.ctx.onViewChange(change);
				if (change.final) this.renderSection(id);
			});
			if (sectionId === "filters") warningsList(body, this.ctx.warnings().filters);
		});
	}

	private colorsSection(): HTMLElement {
		return this.details("colors", "Colour groups", false, (body) => {
			const view = this.ctx.view();
			const core = this.ctx.coreGroups();
			body.append(
				h("div", { class: "g3d-section-desc" }, [
					"Colour notes by search queries (tag:, path:, file:, [property:value], words…). The first matching group wins.",
				]),
			);
			renderControls(
				body,
				[{ type: "toggle", key: "colors.useCoreGroups", label: "Use core graph colour groups (live)", desc: core ? `${core.length} group(s) found in the core graph.` : "No core graph settings found." }],
				view,
				(change) => {
					this.ctx.onViewChange(change);
					this.renderSection("colors");
				},
			);
			const live = view.colors.useCoreGroups;
			renderColorGroupEditor(body, {
				groups: live ? (core ?? []) : view.colors.groups,
				readOnly: live,
				onChange: (groups, final) => this.ctx.onGroupsChange(groups, final),
			});
			if (live) body.append(h("div", { class: "g3d-muted" }, ["Turn off live mode to edit your own groups."]));
			warningsList(body, this.ctx.warnings().colors);
			body.append(
				h("div", { class: "g3d-ctl-heading" }, ["Import from the core graph"]),
				h("div", { class: "g3d-profile-actions" }, [
					button("Colour groups", () => this.ctx.importCoreGraph("colors"), { title: "Copy the core graph's colour groups into this view profile" }),
					button("Filters", () => this.ctx.importCoreGraph("filters"), { title: "Copy search, tags, attachments, orphans and arrows settings" }),
					button("Forces", () => this.ctx.importCoreGraph("forces"), { title: "Approximate the core graph's forces in this force profile" }),
				]),
			);
		});
	}

	private statusSection(): HTMLElement {
		return this.details("status", "Graph info", false, (body) => {
			for (const line of this.ctx.statusLines()) body.append(h("div", { class: "g3d-status-line" }, [line]));
		});
	}
}

function warningsList(parent: HTMLElement, warnings: string[]): void {
	if (!warnings.length) return;
	const list = h("ul", { class: "g3d-warnings" });
	for (const w of warnings) list.append(h("li", {}, [w]));
	parent.append(list);
}

function loadOpenState(): Record<string, boolean> {
	try {
		return JSON.parse(window.localStorage.getItem(OPEN_STATE_KEY) ?? "{}") as Record<string, boolean>;
	} catch {
		return {};
	}
}

function saveOpenState(state: Record<string, boolean>): void {
	try {
		window.localStorage.setItem(OPEN_STATE_KEY, JSON.stringify(state));
	} catch {
		/* storage unavailable — fine */
	}
}
