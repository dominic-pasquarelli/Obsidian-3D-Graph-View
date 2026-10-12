/**
 * Picks which labels to draw so none overlap: the highest-priority label wins
 * its space. Pure and renderer-agnostic (screen-space boxes in, ids out), shared
 * by the 2D and 3D renderers. A uniform grid keeps it near-linear.
 */

export interface LabelBox {
	id: string;
	/** Box centre and size in screen pixels. */
	x: number;
	y: number;
	w: number;
	h: number;
	priority: number;
}

const CELL = 64;

export function declutter(boxes: LabelBox[], padding = 3): Set<string> {
	const kept = new Set<string>();
	const grid = new Map<number, LabelBox[]>();
	const sorted = boxes.slice().sort((a, b) => b.priority - a.priority);
	for (const box of sorted) {
		const x0 = box.x - box.w / 2 - padding;
		const x1 = box.x + box.w / 2 + padding;
		const y0 = box.y - box.h / 2 - padding;
		const y1 = box.y + box.h / 2 + padding;
		const cx0 = Math.floor(x0 / CELL);
		const cx1 = Math.floor(x1 / CELL);
		const cy0 = Math.floor(y0 / CELL);
		const cy1 = Math.floor(y1 / CELL);
		let blocked = false;
		for (let cx = cx0; cx <= cx1 && !blocked; cx++) {
			for (let cy = cy0; cy <= cy1 && !blocked; cy++) {
				for (const other of grid.get(cx * 100003 + cy) ?? []) {
					if (x0 < other.x + other.w / 2 && x1 > other.x - other.w / 2 && y0 < other.y + other.h / 2 && y1 > other.y - other.h / 2) {
						blocked = true;
						break;
					}
				}
			}
		}
		if (blocked) continue;
		kept.add(box.id);
		for (let cx = cx0; cx <= cx1; cx++) {
			for (let cy = cy0; cy <= cy1; cy++) {
				const key = cx * 100003 + cy;
				let cell = grid.get(key);
				if (!cell) grid.set(key, (cell = []));
				cell.push(box);
			}
		}
	}
	return kept;
}
