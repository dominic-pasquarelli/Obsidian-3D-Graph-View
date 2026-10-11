/** Tiny DOM helper (works in Obsidian and in the plain-browser harness). */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Attrs & { class?: string } = {},
	children: Child[] = [],
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (value === undefined || value === null || value === false) continue;
		if (key === "class") el.className = String(value);
		else if (value === true) el.setAttribute(key, "");
		else el.setAttribute(key, String(value));
	}
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		el.append(typeof child === "string" ? document.createTextNode(child) : child);
	}
	return el;
}

export function button(label: string, onClick: (e: MouseEvent) => void, opts: { title?: string; cls?: string; icon?: string } = {}): HTMLButtonElement {
	const el = h("button", { class: `g3d-btn ${opts.cls ?? ""}`.trim(), title: opts.title ?? label, "aria-label": opts.title ?? label, type: "button" }, [label]);
	if (opts.icon) el.dataset.icon = opts.icon;
	el.addEventListener("click", (e) => {
		e.preventDefault();
		onClick(e);
	});
	return el;
}

export function select(options: { value: string; label: string }[], value: string, onChange: (value: string) => void, cls = "g3d-select"): HTMLSelectElement {
	const el = h("select", { class: cls });
	for (const o of options) {
		const opt = h("option", { value: o.value }, [o.label]);
		if (o.value === value) opt.selected = true;
		el.append(opt);
	}
	el.addEventListener("change", () => onChange(el.value));
	return el;
}

export function formatNumber(value: number, step: number): string {
	const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, -Math.floor(Math.log10(step))));
	return value.toFixed(decimals);
}
