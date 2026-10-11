import type { ControlSpec } from "../core/settings/controls";
import { getPath } from "../core/util/object";
import { formatNumber, h } from "./dom";

export interface ControlChange {
	key: string;
	value: unknown;
	/** false while a slider is being dragged; true on release / discrete controls. */
	final: boolean;
}

/**
 * Renders a list of ControlSpecs for one settings object. Calls `onChange` for
 * every edit; the caller re-renders when `final` is true if visibility may change.
 */
export function renderControls<S>(parent: HTMLElement, specs: ControlSpec<S>[], settings: S, onChange: (change: ControlChange) => void): void {
	for (const spec of specs) {
		if (spec.showIf && !spec.showIf(settings)) continue;
		if (spec.type === "heading") {
			parent.append(h("div", { class: "g3d-ctl-heading" }, [spec.label, spec.desc ? h("div", { class: "g3d-ctl-desc" }, [spec.desc]) : null]));
			continue;
		}
		const value = getPath(settings, spec.key);
		const row = h("div", { class: `g3d-ctl g3d-ctl-${spec.type}` });
		const info = h("div", { class: "g3d-ctl-info" }, [h("div", { class: "g3d-ctl-label" }, [spec.label])]);
		if (spec.desc) info.append(h("div", { class: "g3d-ctl-desc" }, [spec.desc]));
		row.append(info);
		const input = h("div", { class: "g3d-ctl-input" });
		row.append(input);

		switch (spec.type) {
			case "slider": {
				const num = typeof value === "number" ? value : spec.min;
				const out = h("span", { class: "g3d-ctl-value" }, [formatNumber(num, spec.step)]);
				const range = h("input", { type: "range", min: spec.min, max: spec.max, step: spec.step, value: num, "data-key": spec.key });
				range.addEventListener("input", () => {
					out.textContent = formatNumber(Number(range.value), spec.step);
					onChange({ key: spec.key, value: Number(range.value), final: false });
				});
				range.addEventListener("change", () => onChange({ key: spec.key, value: Number(range.value), final: true }));
				input.append(range, out);
				break;
			}
			case "toggle": {
				const box = h("input", { type: "checkbox", "data-key": spec.key });
				box.checked = value === true;
				box.addEventListener("change", () => onChange({ key: spec.key, value: box.checked, final: true }));
				input.append(h("label", { class: "g3d-switch" }, [box, h("span", { class: "g3d-switch-slider" })]));
				break;
			}
			case "dropdown": {
				const sel = h("select", { class: "g3d-select", "data-key": spec.key });
				for (const [v, label] of Object.entries(spec.options)) {
					const opt = h("option", { value: v }, [label]);
					if (v === value) opt.selected = true;
					sel.append(opt);
				}
				sel.addEventListener("change", () => onChange({ key: spec.key, value: sel.value, final: true }));
				input.append(sel);
				break;
			}
			case "color": {
				const picker = h("input", { type: "color", value: typeof value === "string" ? value : "#888888", "data-key": spec.key });
				picker.addEventListener("input", () => onChange({ key: spec.key, value: picker.value, final: false }));
				picker.addEventListener("change", () => onChange({ key: spec.key, value: picker.value, final: true }));
				input.append(picker);
				break;
			}
			case "text": {
				const text = h("input", { type: "text", value: typeof value === "string" ? value : "", placeholder: spec.placeholder ?? "", "data-key": spec.key, spellcheck: "false" });
				let timer: number | undefined;
				text.addEventListener("input", () => {
					window.clearTimeout(timer);
					timer = window.setTimeout(() => onChange({ key: spec.key, value: text.value, final: false }), 400);
				});
				text.addEventListener("change", () => {
					window.clearTimeout(timer);
					onChange({ key: spec.key, value: text.value, final: true });
				});
				row.classList.add("g3d-ctl-wide");
				input.append(text);
				break;
			}
		}
		parent.append(row);
	}
}
