import type { ColorGroup } from "../core/color/colorGroups";
import { button, h } from "./dom";

export interface ColorGroupEditorOptions {
	groups: ColorGroup[];
	readOnly: boolean;
	onChange(groups: ColorGroup[], final: boolean): void;
}

/** Ordered list editor for colour groups (first match wins, like the core graph). */
export function renderColorGroupEditor(parent: HTMLElement, opts: ColorGroupEditorOptions): void {
	const groups = opts.groups.map((g) => ({ ...g }));
	const list = h("div", { class: "g3d-groups" });
	parent.append(list);

	const emit = (final: boolean) => opts.onChange(groups.map((g) => ({ ...g })), final);
	const rerender = () => {
		list.replaceChildren();
		groups.forEach((group, i) => {
			const enabled = h("input", { type: "checkbox", title: "Enabled", disabled: opts.readOnly });
			enabled.checked = group.enabled;
			enabled.addEventListener("change", () => {
				group.enabled = enabled.checked;
				emit(true);
			});
			const query = h("input", { type: "text", class: "g3d-group-query", value: group.query, placeholder: "tag:#idea OR path:Projects", disabled: opts.readOnly, spellcheck: "false" });
			query.addEventListener("change", () => {
				group.query = query.value;
				emit(true);
			});
			const color = h("input", { type: "color", value: group.color, disabled: opts.readOnly });
			color.addEventListener("input", () => {
				group.color = color.value;
				emit(false);
			});
			color.addEventListener("change", () => emit(true));
			const row = h("div", { class: "g3d-group-row" }, [enabled, query, color]);
			if (!opts.readOnly) {
				row.append(
					button("↑", () => move(i, -1), { title: "Move up (higher priority)", cls: "g3d-icon-btn" }),
					button("↓", () => move(i, 1), { title: "Move down", cls: "g3d-icon-btn" }),
					button("✕", () => {
						groups.splice(i, 1);
						rerender();
						emit(true);
					}, { title: "Remove group", cls: "g3d-icon-btn" }),
				);
			}
			list.append(row);
		});
		if (groups.length === 0) list.append(h("div", { class: "g3d-muted" }, ["No colour groups."]));
	};
	const move = (i: number, delta: number) => {
		const j = i + delta;
		if (j < 0 || j >= groups.length) return;
		[groups[i], groups[j]] = [groups[j], groups[i]];
		rerender();
		emit(true);
	};
	rerender();
	if (!opts.readOnly) {
		parent.append(
			button("+ Add group", () => {
				const hue = Math.round(Math.random() * 360);
				groups.push({ query: "", color: hslToHex(hue, 65, 55), enabled: true });
				rerender();
				emit(true);
				(list.querySelector(".g3d-group-row:last-child .g3d-group-query") as HTMLInputElement | null)?.focus();
			}, { cls: "g3d-add-btn" }),
		);
	}
}

function hslToHex(h: number, s: number, l: number): string {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(255 * c)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}
