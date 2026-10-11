/** Colour helpers. Everything internal is "#rrggbb" plus an optional alpha applied at render time. */

export function rgbIntToHex(rgb: number): string {
	const clamped = Math.max(0, Math.min(0xffffff, Math.round(rgb)));
	return `#${clamped.toString(16).padStart(6, "0")}`;
}

export function hexToRgbInt(hex: string): number {
	const parsed = parseHex(hex);
	return parsed ? (parsed.r << 16) | (parsed.g << 8) | parsed.b : 0;
}

export function parseHex(hex: string): { r: number; g: number; b: number } | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return null;
	let h = m[1];
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = parseInt(h, 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Normalises any "#rgb" / "#rrggbb" string, falling back when invalid. */
export function normalizeHex(hex: string, fallback = "#888888"): string {
	const parsed = parseHex(hex);
	if (!parsed) return fallback;
	return rgbIntToHex((parsed.r << 16) | (parsed.g << 8) | parsed.b);
}

export function withAlpha(hex: string, alpha: number): string {
	const parsed = parseHex(hex) ?? { r: 136, g: 136, b: 136 };
	const a = Math.max(0, Math.min(1, alpha));
	return `rgba(${parsed.r},${parsed.g},${parsed.b},${a.toFixed(3)})`;
}

/** Linear blend between two hex colours (t=0 → a, t=1 → b). */
export function mix(a: string, b: string, t: number): string {
	const pa = parseHex(a) ?? { r: 0, g: 0, b: 0 };
	const pb = parseHex(b) ?? { r: 0, g: 0, b: 0 };
	const f = (x: number, y: number) => Math.round(x + (y - x) * t);
	return rgbIntToHex((f(pa.r, pb.r) << 16) | (f(pa.g, pb.g) << 8) | f(pa.b, pb.b));
}

/** Converts any CSS colour string the browser understands into "#rrggbb" (browser only). */
export function cssColorToHex(css: string, fallback: string): string {
	const value = css.trim();
	if (!value) return fallback;
	if (value.startsWith("#")) return normalizeHex(value, fallback);
	const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(value);
	if (m) return rgbIntToHex((Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]));
	return fallback;
}
