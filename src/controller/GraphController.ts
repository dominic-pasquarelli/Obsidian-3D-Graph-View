import type { ColorGroup } from "../core/color/colorGroups";
import type { CoreGraphConfig } from "../core/color/coreGraph";
import { AdaptiveExecutor } from "../core/compute/executor";
import { getForceModule, type ForceSettings } from "../core/forces/registry";
import { modelFingerprint } from "../core/graph/fingerprint";
import type { GraphLink, GraphModel, GraphNode } from "../core/graph/types";
import { allLinks } from "../core/graph/types";
import { planPerformance, type PerformancePlan } from "../core/perf/scaling";
import { applyCoreGraphToForces, applyCoreGraphToView } from "../core/profiles/coreGraphMapping";
import type { ProfileKind, ProfileLibrary } from "../core/profiles/ProfileLibrary";
import type { GraphMode, ViewSettings } from "../core/settings/view";
import { clone, setPath, stableKey } from "../core/util/object";
import { createRenderer } from "../renderers/factory";
import { StyleResolver } from "../renderers/style";
import type { GraphRenderer } from "../renderers/types";
import type { ControlChange } from "../ui/ControlRenderer";
import { h } from "../ui/dom";
import { SidePanel, type PanelContext, type ProfileAction } from "../ui/SidePanel";
import { Toolbar, type ToolbarContext } from "../ui/Toolbar";
import { applyForces, detachForces } from "./ForceCoordinator";
import { WorkerPhysics } from "./WorkerPhysics";
import { GraphPipeline, type AugmentResult } from "./GraphPipeline";
import type { ControllerDeps, MenuEntry, NodeMenuAction } from "./ports";

export interface ControllerState {
	forceProfileId?: string;
	viewProfileId?: string;
	mode?: GraphMode;
	panelOpen?: boolean;
}

/**
 * Orchestrates one graph view: owns the working copies of the active force and
 * view profiles, runs the data pipeline, mounts the 2D/3D renderer and wires
 * UI events. Has no Obsidian dependency — everything external goes through
 * the ports in `ControllerDeps`.
 */
export class GraphController implements PanelContext, ToolbarContext {
	readonly root: HTMLElement;
	private canvasEl: HTMLElement;
	private panel: SidePanel;
	private toolbar: Toolbar;
	private renderer: GraphRenderer | null = null;
	private style = new StyleResolver();
	private executor: AdaptiveExecutor;
	private pipeline: GraphPipeline;
	private model: GraphModel | null = null;
	private plan: PerformancePlan;
	private coreConfig: CoreGraphConfig | null = null;
	private forceProfileId: string;
	private viewProfileId: string;
	private forceSettings: ForceSettings;
	private viewSettings: ViewSettings;
	private dirtyCache: Record<ProfileKind, boolean> = { force: false, view: false };
	private open: boolean;
	private disposers: (() => void)[] = [];
	private dataGen = 0;
	private augmentGen = 0;
	private augmentKeys = new Map<string, string>();
	private lastAugment: AugmentResult | null = null;
	private timers = new Map<string, number>();
	private lastPointer: MouseEvent | null = null;
	private interacted = false;
	/** Active busy reasons (build, indirect links…); the status shows the most recent one. */
	private busy = new Map<string, string>();
	private resolveModelReady!: () => void;
	private readonly modelReady = new Promise<void>((resolve) => (this.resolveModelReady = resolve));
	private disposed = false;
	private stateListeners = new Set<() => void>();
	private warningKey = "";
	private fingerprint = "";
	private lastContentQueries: boolean;
	private colorGen = 0;
	private physics: WorkerPhysics | null = null;
	private physicsBroken = false;
	readonly setIcon?: (el: HTMLElement, icon: string) => void;

	constructor(
		container: HTMLElement,
		private readonly deps: ControllerDeps,
		initial: ControllerState = {},
	) {
		const data = deps.store.data;
		this.forceProfileId = data.forces.resolve(initial.forceProfileId ?? data.activeForceProfile).id;
		this.viewProfileId = data.views.resolve(initial.viewProfileId ?? data.activeViewProfile).id;
		this.forceSettings = clone(data.forces.resolve(this.forceProfileId).settings);
		this.viewSettings = clone(data.views.resolve(this.viewProfileId).settings);
		if (initial.mode) this.viewSettings.mode = initial.mode;
		this.open = initial.panelOpen ?? false;
		this.plan = planPerformance(0, 0, data.performance);
		this.lastContentQueries = data.contentQueries;
		this.executor = new AdaptiveExecutor(deps.workerSource);
		this.pipeline = new GraphPipeline(deps.source, this.executor);

		const host = deps.host;
		if (host.setIcon) this.setIcon = (el, icon) => host.setIcon!(el, icon);
		this.root = container;
		this.root.classList.add("g3d-root");
		this.toolbar = new Toolbar(this);
		this.canvasEl = h("div", { class: "g3d-canvas" });
		this.panel = new SidePanel(this);
		const body = h("div", { class: "g3d-body" }, [this.canvasEl, this.panel.el]);
		this.root.replaceChildren(this.toolbar.el, body);
		this.updatePanelVisibility();
	}

	// ---------------------------------------------------------------- lifecycle

	async start(): Promise<void> {
		this.coreConfig = await this.deps.source.readCoreGraphConfig().catch(() => null);
		// The view may have been closed while we were waiting; don't attach anything to a disposed controller.
		if (this.disposed) return;
		this.toolbar.render();
		this.panel.render();
		this.style.configure(this.viewSettings, this.plan, this.deps.host.theme());

		const resize = new ResizeObserver(() => this.renderer?.resize(this.canvasEl.clientWidth, this.canvasEl.clientHeight));
		resize.observe(this.canvasEl);
		this.disposers.push(() => resize.disconnect());
		const onPointer = (e: PointerEvent) => (this.lastPointer = e);
		// The renderers keep hit-testing at the last pointer position after it leaves the canvas,
		// so nodes drifting under that point would still "hover". Forget the pointer on leave.
		const onLeave = () => {
			this.lastPointer = null;
			this.onNodeHover(null);
		};
		const onInteract = () => (this.interacted = true);
		this.canvasEl.addEventListener("pointermove", onPointer);
		this.canvasEl.addEventListener("pointerleave", onLeave);
		this.canvasEl.addEventListener("pointerdown", onInteract);
		this.canvasEl.addEventListener("wheel", onInteract, { passive: true });
		this.disposers.push(() => {
			this.canvasEl.removeEventListener("pointermove", onPointer);
			this.canvasEl.removeEventListener("pointerleave", onLeave);
			this.canvasEl.removeEventListener("pointerdown", onInteract);
			this.canvasEl.removeEventListener("wheel", onInteract);
		});
		this.disposers.push(
			this.deps.source.onChange((changed) => {
				this.pipeline.invalidate(changed);
				void this.refreshData(false);
			}),
		);
		this.disposers.push(this.deps.store.onChange(() => this.onStoreChange()));

		this.mount();
		await this.refreshData();
	}

	dispose(): void {
		this.disposed = true;
		for (const t of this.timers.values()) window.clearTimeout(t);
		for (const d of this.disposers) d();
		this.physics?.dispose();
		this.physics = null;
		this.renderer?.dispose();
		this.renderer = null;
		this.executor.dispose();
		this.stateListeners.clear();
	}

	getState(): ControllerState {
		return { forceProfileId: this.forceProfileId, viewProfileId: this.viewProfileId, mode: this.viewSettings.mode, panelOpen: this.open };
	}

	/** Lets the host persist view state when profiles or panel visibility change. */
	onStateChange(listener: () => void): () => void {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	private emitState(): void {
		for (const l of this.stateListeners) l();
	}

	private debounce(key: string, ms: number, fn: () => void): void {
		window.clearTimeout(this.timers.get(key));
		this.timers.set(
			key,
			window.setTimeout(() => {
				this.timers.delete(key);
				if (!this.disposed) fn();
			}, ms),
		);
	}

	// ---------------------------------------------------------------- pipeline

	private colorGroups(): ColorGroup[] {
		return this.viewSettings.colors.useCoreGroups ? (this.coreConfig?.colorGroups ?? []) : this.viewSettings.colors.groups;
	}

	private get contentQueries(): boolean {
		return this.deps.store.data.contentQueries;
	}

	/**
	 * Full rebuild: vault snapshot → model → colours → renderer → indirect links.
	 * `force` re-pushes even when nothing structural changed.
	 */
	async refreshData(force = true): Promise<void> {
		const gen = ++this.dataGen;
		this.setBusy("data", "Building graph…");
		try {
			const model = await this.pipeline.buildModel(this.viewSettings, this.contentQueries, this.model);
			if (gen !== this.dataGen || this.disposed) return;
			const colorGen = ++this.colorGen;
			// If the user edits colour groups while this build reads note content, their newer
			// refreshColors() wins: this build must not paint the groups it captured earlier.
			await this.pipeline.applyColors(model, this.colorGroups(), this.contentQueries, () => gen === this.dataGen && colorGen === this.colorGen && !this.disposed);
			if (gen !== this.dataGen || this.disposed) return;
			const fingerprint = modelFingerprint(model);
			// Nothing structural changed: keep the current data and any indirect-link computation in flight.
			if (!force && this.model && fingerprint === this.fingerprint) return;
			// Only now invalidate in-flight indirect links — they belong to the model being replaced.
			this.augmentGen++;
			this.fingerprint = fingerprint;
			this.model = model;
			this.plan = planPerformance(model.nodes.length, model.links.length, this.deps.store.data.performance);
			this.style.configure(this.viewSettings, this.plan, this.deps.host.theme());
			this.style.setModel(model);
			this.style.setActive(this.deps.host.activeNodeId());
			this.pushData();
			this.resolveModelReady();
			// The graph is built and shown; indirect-link work has its own busy reason.
			this.setBusy("data", null);
			this.scheduleFit();
			// Colour groups were edited while this build was colouring: recolour with the latest groups.
			if (colorGen !== this.colorGen) void this.refreshColors();
			await this.refreshAugment(true);
		} catch (err) {
			console.error("[3d-graph-view] failed to build graph", err);
			this.deps.host.notify(`Graph build failed: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			if (gen === this.dataGen) this.setBusy("data", null);
			this.refreshWarnings();
		}
	}

	/** Re-render warning lists only when they actually changed (never while the user is typing). */
	private refreshWarnings(): void {
		const key = stableKey(this.warnings());
		if (key === this.warningKey) return;
		this.warningKey = key;
		this.panel.renderSection("view:filters");
		this.panel.renderSection("colors");
	}

	/** Re-runs augmenting modules (indirect links). Cheap when nothing relevant changed. */
	private async refreshAugment(force = false): Promise<void> {
		const model = this.model;
		if (!model) return;
		const keys = new Map<string, string>();
		for (const [id, settings] of Object.entries(this.forceSettings)) {
			const module = getForceModule(id);
			if (module?.augment) keys.set(id, module.augmentKey ? module.augmentKey(settings as never) : stableKey(settings));
		}
		if (!force && stableKey(Array.from(keys)) === stableKey(Array.from(this.augmentKeys))) return;
		this.augmentKeys = keys;
		const gen = ++this.augmentGen;
		const willCompute = Array.from(keys.values()).some((k) => k !== "off");
		if (willCompute) this.setBusy("augment", this.plan.useWorker ? "Computing indirect links (worker)…" : "Computing indirect links…");
		try {
			const result = await this.pipeline.augment(model, this.forceSettings, this.plan);
			if (gen !== this.augmentGen || this.disposed || model !== this.model) return;
			const changed = result.links !== model.extraLinks && (result.links.length > 0 || model.extraLinks.length > 0);
			this.lastAugment = result;
			model.extraLinks = result.links;
			model.stats.indirectLinks = result.links.filter((l) => l.kind === "indirect").length;
			if (changed) {
				this.style.setModel(model);
				this.pushData();
			}
		} catch (err) {
			if (!(err instanceof Error && err.message === "Executor disposed")) {
				console.error("[3d-graph-view] indirect links failed", err);
				this.deps.host.notify("Computing indirect links failed — see the developer console.");
			}
		} finally {
			if (gen === this.augmentGen) this.setBusy("augment", null);
		}
	}

	private async refreshColors(): Promise<void> {
		// Bump first: an edit made while the very first build is still colouring must win over it
		// (that build then skips its stale apply and recolours once committed).
		const gen = ++this.colorGen;
		const model = this.model;
		if (!model) return;
		// Only the newest request may write colours (an older, slower one would paint stale groups).
		const applied = await this.pipeline.applyColors(model, this.colorGroups(), this.contentQueries, () => gen === this.colorGen && model === this.model && !this.disposed);
		if (!applied) return;
		// Keep the "nothing changed" check in refreshData comparing against what is actually shown.
		this.fingerprint = modelFingerprint(model);
		this.renderer?.refreshStyle();
		if ((this.forceSettings.groups as { enabled?: boolean } | undefined)?.enabled) this.reapplyForces();
		this.refreshWarnings();
	}

	/** Whether the force simulation should run in the background worker for the current graph. */
	private get workerPhysics(): boolean {
		return this.plan.physicsInWorker && !!this.deps.workerSource && !this.physicsBroken;
	}

	private ensurePhysics(): WorkerPhysics {
		if (!this.physics) {
			this.physics = new WorkerPhysics(this.deps.workerSource!, () => {
				// Fall back to main-thread physics for the rest of this view's life.
				this.physicsBroken = true;
				this.physics = null;
				this.deps.host.notify("Background physics failed; using the main thread instead.");
				this.pushData();
			});
		}
		return this.physics;
	}

	private pushData(): void {
		if (!this.renderer || !this.model) return;
		const links = allLinks(this.model);
		this.renderer.setData(this.model.nodes, links);
		this.installPhysics(links);
		this.renderer.applySettings();
		this.updateStatus();
	}

	private installPhysics(links: GraphLink[] = this.model ? allLinks(this.model) : []): void {
		if (!this.renderer || !this.model) return;
		if (this.workerPhysics) {
			detachForces(this.renderer, this.model, this.plan, this.forceSettings);
			this.ensurePhysics().start(this.renderer, this.model, links, this.forceSettings, this.plan);
		} else {
			this.physics?.stop();
			applyForces(this.renderer, this.model, this.plan, this.forceSettings);
		}
	}

	private reapplyForces(): void {
		if (!this.renderer || !this.model) return;
		if (this.physics?.running) {
			this.physics.update(this.forceSettings, this.plan);
			return;
		}
		applyForces(this.renderer, this.model, this.plan, this.forceSettings);
		this.renderer.reheat();
	}

	private mount(): void {
		this.physics?.stop();
		this.renderer?.dispose();
		const mode = this.viewSettings.mode;
		if (mode === "3d" && this.model) {
			// Coming from 2D: give nodes a thin z spread so the layout inflates instead of re-initialising.
			for (const n of this.model.nodes) if (n.z === undefined || Number.isNaN(n.z)) n.z = (Math.random() - 0.5) * 10;
		}
		this.style.setDims(mode === "2d" ? 2 : 3);
		this.renderer = createRenderer(mode, {
			container: this.canvasEl,
			style: this.style,
			controls3d: this.viewSettings.interaction.controls3d,
			events: {
				onNodeClick: (node, e) => this.onNodeClick(node, e),
				onNodeRightClick: (node, e) => this.onNodeMenu(node, e),
				onNodeHover: (node) => this.onNodeHover(node),
				onNodeDrag: (node) => this.physics?.fix(node, true),
				onNodeDragEnd: (node) => this.onNodeDragEnd(node),
				onBackgroundClick: () => this.onNodeHover(null),
			},
		});
		this.renderer.resize(this.canvasEl.clientWidth, this.canvasEl.clientHeight);
		this.interacted = false;
		if (this.model) {
			this.pushData();
			this.scheduleFit();
		}
	}

	private scheduleFit(): void {
		this.debounce("fit", 1600, () => {
			if (!this.interacted) this.renderer?.zoomToFit();
		});
	}

	private setBusy(reason: string, text: string | null): void {
		if (text === null) this.busy.delete(reason);
		else {
			this.busy.delete(reason); // re-insert so the newest reason is shown
			this.busy.set(reason, text);
		}
		this.updateStatus();
	}

	/** Resolves once the first model has been pushed to the renderer. */
	whenModelReady(): Promise<void> {
		return this.modelReady;
	}

	private updateStatus(): void {
		const m = this.model;
		const busyText = Array.from(this.busy.values()).pop();
		const text = busyText ?? (m ? `${m.stats.notes + m.stats.attachments + m.stats.tags} nodes · ${m.stats.unresolved} uncreated · ${m.stats.links} links${m.stats.indirectLinks ? ` · ${m.stats.indirectLinks} indirect` : ""}` : "");
		this.toolbar.setStatus(text, busyText !== undefined);
	}

	statusLines(): string[] {
		const m = this.model;
		if (!m) return ["Loading…"];
		const lines = [
			`Notes: ${m.stats.notes}`,
			`Not created yet: ${m.stats.unresolved}`,
			`Attachments: ${m.stats.attachments}`,
			`Tags: ${m.stats.tags}`,
			`Links: ${m.stats.links}`,
			`Indirect links: ${m.stats.indirectLinks}`,
			`Performance tier: ${this.plan.tier} (load ${Math.round(this.plan.load)})`,
			`Indirect-link maths runs on: ${this.plan.useWorker ? "worker thread" : "main thread"}`,
			`Physics runs on: ${this.physics?.running ? "worker thread" : "main thread"}`,
		];
		if (this.lastAugment && this.lastAugment.ranOn !== "none") lines.push(`Last indirect computation: ${Math.round(this.lastAugment.ms)} ms (${this.lastAugment.ranOn})`);
		return lines;
	}

	warnings(): { filters: string[]; colors: string[] } {
		return { filters: this.pipeline.filterWarnings, colors: this.pipeline.colorWarnings };
	}

	// ---------------------------------------------------------------- node events

	private onNodeClick(node: GraphNode, event: MouseEvent): void {
		const newTab = event.ctrlKey || event.metaKey;
		if (node.kind === "unresolved" && !this.deps.store.data.createOnGhostClick) {
			this.renderer?.focusNode(node);
			return;
		}
		this.deps.host.openNode(node, newTab);
	}

	private onNodeMenu(node: GraphNode, event: MouseEvent): void {
		const actions: NodeMenuAction[] = [];
		if (node.kind === "unresolved") actions.push({ title: "Create note", icon: "file-plus", run: () => this.deps.host.openNode(node, false) });
		else {
			actions.push({ title: "Open", icon: "file", run: () => this.deps.host.openNode(node, false) });
			actions.push({ title: "Open in new tab", icon: "file-plus-2", run: () => this.deps.host.openNode(node, true) });
		}
		actions.push({ title: "Focus here", icon: "crosshair", run: () => this.renderer?.focusNode(node) });
		const pinned = node.fx !== undefined;
		actions.push({
			title: pinned ? "Unpin" : "Pin in place",
			icon: pinned ? "pin-off" : "pin",
			run: () => {
				if (pinned) {
					node.fx = node.fy = node.fz = undefined;
					this.renderer?.reheat();
				} else {
					node.fx = node.x;
					node.fy = node.y;
					if (this.renderer?.dims === 3) node.fz = node.z;
				}
				this.physics?.fix(node, false);
			},
		});
		this.deps.host.showNodeMenu(node, event, actions);
	}

	private onNodeHover(node: GraphNode | null): void {
		// Ignore "hovers" produced by nodes drifting under a pointer that is no longer over the graph.
		const hovered = this.lastPointer ? node : null;
		if (this.style.setHover(hovered?.id ?? null)) this.renderer?.refreshStyle();
		this.deps.host.hoverPreview?.(hovered, hovered ? this.lastPointer : null);
	}

	private onNodeDragEnd(node: GraphNode): void {
		if (this.viewSettings.interaction.pinOnDrag) {
			node.fx = node.x;
			node.fy = node.y;
			if (this.renderer?.dims === 3) node.fz = node.z;
		}
		this.physics?.fix(node, false);
	}

	/** Called by the host when the active note changes. */
	onActiveFileChange(): void {
		if (this.style.setActive(this.deps.host.activeNodeId())) this.renderer?.refreshStyle();
	}

	/** Called by the host when the theme / CSS changes. */
	onThemeChange(): void {
		this.style.configure(this.viewSettings, this.plan, this.deps.host.theme());
		this.renderer?.applySettings();
	}

	/** Re-reads the core graph settings (e.g. when the view regains focus). */
	async reloadCoreGraph(): Promise<void> {
		const next = await this.deps.source.readCoreGraphConfig().catch(() => null);
		if (stableKey(next) === stableKey(this.coreConfig)) return;
		this.coreConfig = next;
		if (this.viewSettings.colors.useCoreGroups) await this.refreshColors();
		else this.panel.renderSection("colors");
	}

	// ---------------------------------------------------------------- settings edits

	forces(): ForceSettings {
		return this.forceSettings;
	}

	view(): ViewSettings {
		return this.viewSettings;
	}

	coreGroups(): ColorGroup[] | null {
		return this.coreConfig ? this.coreConfig.colorGroups : null;
	}

	/** Re-checks whether the working copy differs from the saved profile and updates the UI if that flipped. */
	private markDirty(kind: ProfileKind): void {
		const dirty = this.computeDirty(kind);
		if (this.dirtyCache[kind] === dirty) return;
		this.dirtyCache[kind] = dirty;
		this.toolbar.render();
		this.panel.renderSection("profiles");
	}

	/** The 2D/3D toggle is a per-tab choice, so it never counts as an unsaved profile change. */
	private computeDirty(kind: ProfileKind): boolean {
		const data = this.deps.store.data;
		if (kind === "force") return stableKey(this.forceSettings) !== stableKey(data.forces.get(this.forceProfileId)?.settings);
		const saved = data.views.get(this.viewProfileId)?.settings;
		if (!saved) return true;
		return stableKey({ ...this.viewSettings, mode: "" }) !== stableKey({ ...saved, mode: "" });
	}

	onForceChange(moduleId: string, change: ControlChange): void {
		const settings = this.forceSettings[moduleId];
		if (!settings) return;
		setPath(settings, change.key, change.value);
		this.markDirty("force");
		this.reapplyForces();
		if (getForceModule(moduleId)?.augment) this.debounce("augment", change.final ? 50 : 350, () => void this.refreshAugment());
	}

	onViewChange(change: ControlChange): void {
		const previous = clone(this.viewSettings);
		setPath(this.viewSettings as unknown as Record<string, unknown>, change.key, change.value);
		this.markDirty("view");
		this.applyViewChange(previous, change.final);
	}

	onGroupsChange(groups: ColorGroup[], final: boolean): void {
		this.viewSettings.colors.groups = groups;
		this.markDirty("view");
		this.debounce("colors", final ? 0 : 60, () => void this.refreshColors());
	}

	/** Works out the cheapest update that reflects a view-settings change. */
	private applyViewChange(previous: ViewSettings, final: boolean): void {
		const next = this.viewSettings;
		this.style.configure(next, this.plan, this.deps.host.theme());
		if (previous.links.showIndirect !== next.links.showIndirect && this.model) this.style.setModel(this.model);
		if (previous.mode !== next.mode || previous.interaction.controls3d !== next.interaction.controls3d) {
			this.toolbar.render();
			this.panel.render();
			this.mount();
		}
		if (stableKey(previous.filters) !== stableKey(next.filters)) {
			this.debounce("data", final ? 0 : 250, () => void this.refreshData());
			return;
		}
		if (previous.colors.useCoreGroups !== next.colors.useCoreGroups || stableKey(previous.colors.groups) !== stableKey(next.colors.groups)) {
			void this.refreshColors();
		}
		this.renderer?.applySettings();
	}

	/** Replaces both working copies at once (used by profile switches and imports). */
	private replaceView(next: ViewSettings): void {
		const previous = this.viewSettings;
		this.viewSettings = next;
		this.dirtyCache.view = this.computeDirty("view");
		this.toolbar.render();
		this.panel.render();
		this.applyViewChange(previous, true);
	}

	private replaceForces(next: ForceSettings): void {
		this.forceSettings = next;
		this.dirtyCache.force = this.computeDirty("force");
		this.toolbar.render();
		this.panel.render();
		this.reapplyForces();
		void this.refreshAugment();
	}

	importCoreGraph(what: "colors" | "filters" | "forces"): void {
		const core = this.coreConfig;
		if (!core) {
			this.deps.host.notify("No core graph settings found in this vault.");
			return;
		}
		if (what === "forces") {
			this.replaceForces(applyCoreGraphToForces(this.forceSettings, core));
			this.deps.host.notify("Imported core graph forces into the current force profile (not saved yet).");
			return;
		}
		const next = clone(this.viewSettings);
		if (what === "colors") {
			next.colors.groups = clone(core.colorGroups);
			next.colors.useCoreGroups = false;
		} else {
			const mapped = applyCoreGraphToView(next, core, false);
			next.filters = mapped.filters;
			next.links.arrows = mapped.links.arrows;
		}
		this.replaceView(next);
		this.deps.host.notify(`Imported core graph ${what} into the current view profile (not saved yet).`);
	}

	// ---------------------------------------------------------------- profiles

	private library(kind: ProfileKind): ProfileLibrary<ForceSettings> | ProfileLibrary<ViewSettings> {
		return kind === "force" ? this.deps.store.data.forces : this.deps.store.data.views;
	}

	profiles(kind: ProfileKind): { id: string; name: string }[] {
		return this.library(kind)
			.list()
			.map((p) => ({ id: p.id, name: p.name }));
	}

	activeProfile(kind: ProfileKind): string {
		return kind === "force" ? this.forceProfileId : this.viewProfileId;
	}

	isDirty(kind: ProfileKind): boolean {
		return this.dirtyCache[kind];
	}

	async selectProfile(kind: ProfileKind, id: string, skipConfirm = false): Promise<void> {
		if (id === this.activeProfile(kind) && !this.computeDirty(kind)) return;
		if (!skipConfirm && this.computeDirty(kind)) {
			const ok = await this.deps.host.confirm(`Discard unsaved changes to the current ${kind} profile?`);
			if (!ok) {
				this.toolbar.render();
				this.panel.renderSection("profiles");
				return;
			}
		}
		const data = this.deps.store.data;
		if (kind === "force") {
			const profile = data.forces.resolve(id);
			this.forceProfileId = profile.id;
			data.activeForceProfile = profile.id;
			this.replaceForces(clone(profile.settings));
		} else {
			const profile = data.views.resolve(id);
			this.viewProfileId = profile.id;
			data.activeViewProfile = profile.id;
			// 2D/3D is a per-tab choice: switching (or reverting) a view profile keeps the tab's mode.
			this.replaceView({ ...clone(profile.settings), mode: this.viewSettings.mode });
		}
		this.emitState();
		await this.deps.store.save();
	}

	showMenu(event: MouseEvent, entries: MenuEntry[]): void {
		this.deps.host.showMenu(event, entries);
	}

	async profileAction(kind: ProfileKind, action: ProfileAction): Promise<void> {
		const host = this.deps.host;
		const lib = this.library(kind) as ProfileLibrary<unknown>;
		const id = this.activeProfile(kind);
		const current = lib.get(id);
		const working = kind === "force" ? this.forceSettings : this.viewSettings;
		switch (action) {
			case "save":
				lib.save(id, working);
				break;
			case "saveAs": {
				const name = await host.prompt(`Name for the new ${kind} profile`, lib.uniqueName(current?.name ?? "My profile"));
				if (!name) return;
				const created = lib.create(name, working);
				await this.selectProfile(kind, created.id, true);
				break;
			}
			case "duplicate": {
				const copy = lib.duplicate(id);
				if (!copy) return;
				await this.selectProfile(kind, copy.id, true);
				break;
			}
			case "rename": {
				const name = await host.prompt(`Rename "${current?.name}"`, current?.name ?? "");
				if (!name) return;
				lib.rename(id, name);
				break;
			}
			case "delete": {
				if (lib.list().length <= 1) {
					host.notify("You need at least one profile.");
					return;
				}
				if (!(await host.confirm(`Delete the ${kind} profile "${current?.name}"?`))) return;
				lib.remove(id);
				await this.selectProfile(kind, lib.list()[0].id, true);
				break;
			}
			case "revert":
				await this.selectProfile(kind, id, true);
				return;
			case "export": {
				const json = lib.exportProfile(id);
				if (!json || !current) return;
				try {
					const path = await host.saveProfileFile(kind, current.name, json);
					host.notify(`Exported to ${path}`);
				} catch (err) {
					host.notify(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				return;
			}
			case "import": {
				const json = await host.pickProfileFile(kind);
				if (!json) return;
				try {
					const imported = lib.importProfile(json);
					await this.selectProfile(kind, imported.id, true);
					host.notify(`Imported "${imported.name}".`);
				} catch (err) {
					host.notify(err instanceof Error ? err.message : String(err));
					return;
				}
				break;
			}
		}
		await this.deps.store.save();
		this.markDirty(kind);
		this.toolbar.render();
		this.panel.renderSection("profiles");
	}

	/** Another view or the settings tab changed shared state. */
	private onStoreChange(): void {
		const data = this.deps.store.data;
		if (data.contentQueries !== this.lastContentQueries) {
			// Filters and colour groups may match differently with content search on/off.
			this.lastContentQueries = data.contentQueries;
			void this.refreshData(true);
		}
		if (!data.forces.get(this.forceProfileId)) void this.selectProfile("force", data.forces.list()[0].id, true);
		if (!data.views.get(this.viewProfileId)) void this.selectProfile("view", data.views.list()[0].id, true);
		const plan = planPerformance(this.model?.nodes.length ?? 0, this.model?.links.length ?? 0, data.performance);
		if (stableKey(plan) !== stableKey(this.plan)) {
			this.plan = plan;
			this.style.configure(this.viewSettings, plan, this.deps.host.theme());
			this.installPhysics();
			this.renderer?.applySettings();
			void this.refreshAugment(true);
		}
		this.dirtyCache.force = this.computeDirty("force");
		this.dirtyCache.view = this.computeDirty("view");
		this.toolbar.render();
		this.panel.renderSection("profiles");
	}

	// ---------------------------------------------------------------- toolbar

	mode(): GraphMode {
		return this.viewSettings.mode;
	}

	setMode(mode: GraphMode): void {
		if (mode === this.viewSettings.mode) return;
		this.onViewChange({ key: "mode", value: mode, final: true });
		this.emitState();
	}

	find(query: string): boolean {
		const q = query.trim().toLowerCase();
		if (!q || !this.model) {
			if (this.style.setHover(null)) this.renderer?.refreshStyle();
			return false;
		}
		const nodes = this.model.nodes;
		const hit =
			nodes.find((n) => n.name.toLowerCase() === q) ??
			nodes.find((n) => n.name.toLowerCase().startsWith(q)) ??
			nodes.find((n) => n.name.toLowerCase().includes(q) || (n.path ?? "").toLowerCase().includes(q));
		if (!hit) return false;
		this.interacted = true;
		this.renderer?.focusNode(hit);
		if (this.style.setHover(hit.id)) this.renderer?.refreshStyle();
		return true;
	}

	/** Focus a node by id (used by the "show active note in graph" command). */
	focusNodeById(id: string): boolean {
		const node = this.model?.nodeById.get(id);
		if (!node) return false;
		this.interacted = true;
		this.renderer?.focusNode(node);
		return true;
	}

	fit(): void {
		this.renderer?.zoomToFit();
	}

	shake(): void {
		if (this.physics?.running) this.physics.reheat();
		else this.renderer?.reheat();
	}

	refresh(): void {
		this.pipeline.invalidate(null);
		void this.reloadCoreGraph();
		void this.refreshData();
	}

	togglePanel(): void {
		this.open = !this.open;
		this.updatePanelVisibility();
		this.toolbar.render();
		this.emitState();
	}

	panelOpen(): boolean {
		return this.open;
	}

	private updatePanelVisibility(): void {
		this.panel.el.classList.toggle("is-hidden", !this.open);
		// Let the canvas pick up its new width.
		window.requestAnimationFrame(() => this.renderer?.resize(this.canvasEl.clientWidth, this.canvasEl.clientHeight));
	}

	/** Screen position of a node inside the canvas (used by the harness / future overlays). */
	screenPosition(id: string): { x: number; y: number } | null {
		const node = this.model?.nodeById.get(id);
		const pos = node && this.renderer?.screenPosition(node);
		if (!pos) return null;
		const rect = this.canvasEl.getBoundingClientRect();
		return { x: rect.left + pos.x, y: rect.top + pos.y };
	}

	/** Exposed for tests / the harness. */
	debugState(): { model: GraphModel | null; plan: PerformancePlan; extraLinks: GraphLink[]; forces: ForceSettings; view: ViewSettings } {
		return { model: this.model, plan: this.plan, extraLinks: this.model?.extraLinks ?? [], forces: this.forceSettings, view: this.viewSettings };
	}
}
