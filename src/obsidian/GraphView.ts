import { ItemView, type HoverParent, type HoverPopover, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import workerSource from "virtual:compute-worker";
import { VIEW_ICON, VIEW_TYPE_GRAPH } from "../constants";
import { GraphController, type ControllerState } from "../controller/GraphController";
import type GraphViewPlugin from "../main";
import { ObsidianDataSource } from "./ObsidianDataSource";
import { ObsidianHost } from "./ObsidianHost";

/** Obsidian wrapper around a GraphController. All graph logic lives in the controller. */
export class GraphView extends ItemView implements HoverParent {
	hoverPopover: HoverPopover | null = null;
	override navigation = false;
	private controller: GraphController | null = null;
	private pending: ControllerState = {};
	private startTimer: number | null = null;
	private resolveReady!: (controller: GraphController) => void;
	/** Resolves with the controller once the first graph has been built and shown. */
	readonly ready = new Promise<GraphController>((resolve) => (this.resolveReady = resolve));

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: GraphViewPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_GRAPH;
	}

	getDisplayText(): string {
		return this.controller?.mode() === "2d" ? "2D graph" : "3D graph";
	}

	override getIcon(): string {
		return VIEW_ICON;
	}

	override async onOpen(): Promise<void> {
		this.contentEl.addClass("g3d-view");
		// setState() usually follows onOpen; give it a moment so we start with the right profiles.
		this.startTimer = window.setTimeout(() => this.startInBackground(), 30);
	}

	/** Never make Obsidian wait for a graph build (setState is awaited during layout restore). */
	private startInBackground(): void {
		this.start().catch((err) => console.error("[3d-graph-view] failed to start graph view", err));
	}

	private async start(): Promise<void> {
		if (this.controller) return;
		if (this.startTimer !== null) window.clearTimeout(this.startTimer);
		this.startTimer = null;
		const host = new ObsidianHost(this.app, this, () => this.plugin.store.data.profileFolder);
		const controller = new GraphController(
			this.contentEl,
			{ source: new ObsidianDataSource(this.app), host, store: this.plugin.store, workerSource },
			this.pending,
		);
		this.controller = controller;
		controller.onStateChange(() => {
			this.app.workspace.requestSaveLayout();
			// Tab title follows the mode.
			(this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();
		});
		this.registerEvent(this.app.workspace.on("file-open", () => controller.onActiveFileChange()));
		this.registerEvent(this.app.workspace.on("css-change", () => controller.onThemeChange()));
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) void controller.reloadCoreGraph();
			}),
		);
		void controller.whenModelReady().then(() => this.resolveReady(controller));
		await controller.start();
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const s = (state ?? {}) as ControllerState;
		if (this.controller) {
			if (s.mode) this.controller.setMode(s.mode);
		} else {
			this.pending = { ...this.pending, ...s };
			this.startInBackground();
		}
		await super.setState(state, result);
	}

	override getState(): Record<string, unknown> {
		return { ...(this.controller?.getState() ?? this.pending) };
	}

	override async onClose(): Promise<void> {
		if (this.startTimer !== null) window.clearTimeout(this.startTimer);
		this.controller?.dispose();
		this.controller = null;
	}

	getController(): GraphController | null {
		return this.controller;
	}
}
