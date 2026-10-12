/**
 * Page-preview handling for graph nodes, modelled on Obsidian's own graph view
 * (GraphEngine.onNodeHover / onNodeUnhover):
 *  - trigger "hover-link" with no target element, so Page preview neither blocks a
 *    new preview because "the canvas" already has one, nor arms its "press Ctrl
 *    later" listener for every node the pointer crosses;
 *  - on every hover change, mark the open popover as no longer on its target so it
 *    closes on its own (it stays while the pointer is over the popover itself);
 *  - re-hovering the note whose popover is still visible keeps that popover.
 *
 * Obsidian-free (popover internals are optional and feature-detected), so it can be unit-tested.
 */

/** PopoverState.Hidden in Obsidian (Showing 0, Shown 1, Hiding 2, Hidden 3). */
export const POPOVER_HIDDEN = 3;

/** The non-public parts of HoverPopover this uses; every member is optional. */
export interface PopoverLike {
	state?: number;
	onTarget?: boolean;
	transition?: () => void;
}

export interface PopoverParent {
	hoverPopover: PopoverLike | null;
}

export class HoverPreviewSession {
	private lastLink: string | null = null;

	constructor(
		private readonly parent: PopoverParent,
		private readonly trigger: (linktext: string, event: MouseEvent) => void,
	) {}

	/** Call on every hover change; `linktext` null means "nothing previewable is hovered". */
	hover(linktext: string | null, event: MouseEvent | null): void {
		const open = this.live();
		if (open && typeof open.transition === "function" && linktext !== null && linktext === this.lastLink) {
			// Same note again (nodes drift under the pointer while the layout settles): keep its preview.
			open.onTarget = true;
			open.transition?.();
			return;
		}
		this.unhover();
		if (linktext === null || event === null) return;
		this.lastLink = linktext;
		this.trigger(linktext, event);
	}

	/** Let the open preview close unless the pointer is over the preview itself. */
	unhover(): void {
		const open = this.live();
		if (!open || typeof open.transition !== "function") return;
		open.onTarget = false;
		open.transition();
	}

	/** The parent's popover if it is still showing (a closed one may linger on the parent, e.g. with Hover Editor). */
	private live(): PopoverLike | null {
		const p = this.parent.hoverPopover;
		if (!p) return null;
		if (typeof p.state === "number" && p.state === POPOVER_HIDDEN) return null;
		return p;
	}
}
