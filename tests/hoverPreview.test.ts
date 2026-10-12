import { describe, expect, it } from "vitest";
import { HoverPreviewSession, POPOVER_HIDDEN, type PopoverLike, type PopoverParent } from "../src/obsidian/HoverPreviewSession";

function setup() {
	const parent: PopoverParent = { hoverPopover: null };
	const triggered: string[] = [];
	const transitions: boolean[] = [];
	const session = new HoverPreviewSession(parent, (link) => {
		triggered.push(link);
		// Page preview: showing a new popover replaces the parent's popover.
		const popover: PopoverLike = { state: 1, onTarget: true, transition: () => void transitions.push(popover.onTarget!) };
		parent.hoverPopover = popover;
	});
	const ev = {} as MouseEvent;
	return { parent, triggered, transitions, session, ev };
}

describe("HoverPreviewSession (mirrors Obsidian's graph view)", () => {
	it("triggers a preview per newly hovered note", () => {
		const t = setup();
		t.session.hover("A.md", t.ev);
		t.session.hover("B.md", t.ev);
		expect(t.triggered).toEqual(["A.md", "B.md"]);
	});

	it("re-hovering the note whose preview is open keeps it instead of re-triggering", () => {
		const t = setup();
		t.session.hover("A.md", t.ev);
		t.session.hover(null, null); // node drifts away: popover told it's off target
		t.session.hover("A.md", t.ev); // and back
		expect(t.triggered).toEqual(["A.md"]);
		expect(t.transitions).toEqual([false, true]);
	});

	it("moving to another note lets the open preview close (it is no longer on target)", () => {
		const t = setup();
		t.session.hover("A.md", t.ev);
		const a = t.parent.hoverPopover!;
		t.session.hover("B.md", t.ev);
		expect(a.onTarget).toBe(false);
		expect(t.triggered).toEqual(["A.md", "B.md"]);
	});

	it("treats a closed popover still attached to the parent as gone (e.g. Hover Editor)", () => {
		const t = setup();
		t.session.hover("A.md", t.ev);
		t.parent.hoverPopover!.state = POPOVER_HIDDEN;
		t.session.hover("A.md", t.ev);
		expect(t.triggered).toEqual(["A.md", "A.md"]);
	});

	it("works when the popover lacks the internal members (falls back to re-triggering)", () => {
		const t = setup();
		t.parent.hoverPopover = {};
		expect(() => t.session.hover("A.md", t.ev)).not.toThrow();
		t.parent.hoverPopover = {};
		t.session.hover("A.md", t.ev);
		expect(t.triggered).toEqual(["A.md", "A.md"]);
	});
});
