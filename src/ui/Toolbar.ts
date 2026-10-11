import type { GraphMode } from "../core/settings/view";
import { button, h } from "./dom";

export interface ToolbarContext {
	mode(): GraphMode;
	setMode(mode: GraphMode): void;
	profiles(kind: "force" | "view"): { id: string; name: string }[];
	activeProfile(kind: "force" | "view"): string;
	isDirty(kind: "force" | "view"): boolean;
	selectProfile(kind: "force" | "view", id: string): void;
	find(query: string): boolean;
	fit(): void;
	shake(): void;
	refresh(): void;
	togglePanel(): void;
	panelOpen(): boolean;
	readonly setIcon?: (el: HTMLElement, icon: string) => void;
}

/**
 * Top bar of the graph view: mode switch, profile pickers, search and actions.
 * Built once; `render()` only refreshes state so typing in the search box is never interrupted.
 */
export class Toolbar {
	readonly el: HTMLElement;
	private statusEl = h("div", { class: "g3d-toolbar-status" });
	private modeButtons = new Map<GraphMode, HTMLButtonElement>();
	private selects = new Map<"force" | "view", HTMLSelectElement>();
	private panelButton: HTMLButtonElement;

	constructor(private readonly ctx: ToolbarContext) {
		this.el = h("div", { class: "g3d-toolbar" });
		const modes = h("div", { class: "g3d-segmented", role: "group", "aria-label": "View mode" });
		for (const mode of ["3d", "2d"] as const) {
			const b = button(mode.toUpperCase(), () => ctx.setMode(mode), { title: `Switch to ${mode.toUpperCase()} view` });
			this.modeButtons.set(mode, b);
			modes.append(b);
		}
		const profilePicker = (kind: "force" | "view", label: string) => {
			const sel = h("select", { class: "g3d-select", title: `${label} profile` });
			sel.addEventListener("change", () => ctx.selectProfile(kind, sel.value));
			this.selects.set(kind, sel);
			return h("label", { class: "g3d-toolbar-profile" }, [h("span", { class: "g3d-toolbar-label" }, [label]), sel]);
		};
		const search = h("input", { type: "search", class: "g3d-find", placeholder: "Find note…", spellcheck: "false" });
		search.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				const found = ctx.find(search.value);
				search.classList.toggle("is-not-found", !found && search.value.trim().length > 0);
			}
			if (e.key === "Escape") {
				search.value = "";
				search.classList.remove("is-not-found");
				ctx.find("");
			}
		});
		const iconButton = (label: string, icon: string, title: string, run: () => void) => {
			const b = button(label, run, { title, cls: "g3d-icon-btn" });
			if (ctx.setIcon) {
				b.replaceChildren();
				ctx.setIcon(b, icon);
			}
			return b;
		};
		this.panelButton = iconButton("Settings", "sliders-horizontal", "Show / hide the settings panel", () => ctx.togglePanel());
		this.el.append(
			modes,
			profilePicker("force", "Forces"),
			profilePicker("view", "View"),
			search,
			h("div", { class: "g3d-toolbar-spacer" }),
			this.statusEl,
			iconButton("Fit", "maximize", "Zoom to fit", () => ctx.fit()),
			iconButton("Shake", "zap", "Re-run the physics", () => ctx.shake()),
			iconButton("Reload", "refresh-cw", "Rebuild the graph from the vault", () => ctx.refresh()),
			this.panelButton,
		);
	}

	render(): void {
		const ctx = this.ctx;
		for (const [mode, b] of this.modeButtons) b.classList.toggle("is-active", ctx.mode() === mode);
		for (const [kind, sel] of this.selects) {
			const active = ctx.activeProfile(kind);
			sel.replaceChildren(
				...ctx.profiles(kind).map((p) => {
					const opt = h("option", { value: p.id }, [p.name + (p.id === active && ctx.isDirty(kind) ? " •" : "")]);
					opt.selected = p.id === active;
					return opt;
				}),
			);
		}
		this.panelButton.classList.toggle("is-active", ctx.panelOpen());
	}

	setStatus(text: string, busy: boolean): void {
		this.statusEl.textContent = text;
		this.statusEl.classList.toggle("is-busy", busy);
	}
}
