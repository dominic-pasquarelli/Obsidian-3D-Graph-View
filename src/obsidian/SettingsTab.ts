import { PluginSettingTab, Setting, type App } from "obsidian";
import type { PerfMode, PhysicsMode, WorkerMode } from "../core/perf/scaling";
import type GraphViewPlugin from "../main";

/** Global (non-profile) settings. Forces and display live in profiles, edited inside the view. */
export class GraphSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: GraphViewPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		const store = this.plugin.store;
		const data = store.data;
		containerEl.empty();

		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Forces, colours, filters and display options are saved as profiles and edited from the panel inside the graph view (sliders icon).",
		});

		new Setting(containerEl).setName("Profiles").setHeading();
		new Setting(containerEl)
			.setName("Default force profile")
			.setDesc("Used when opening a new graph view.")
			.addDropdown((d) => {
				for (const p of data.forces.list()) d.addOption(p.id, p.name);
				d.setValue(data.activeForceProfile ?? "").onChange(async (v) => {
					data.activeForceProfile = v;
					await store.save();
				});
			});
		new Setting(containerEl)
			.setName("Default view profile")
			.setDesc("Used when opening a new graph view.")
			.addDropdown((d) => {
				for (const p of data.views.list()) d.addOption(p.id, p.name);
				d.setValue(data.activeViewProfile ?? "").onChange(async (v) => {
					data.activeViewProfile = v;
					await store.save();
				});
			});
		new Setting(containerEl)
			.setName("Profile folder")
			.setDesc("Vault folder used to export and import profile files (shareable JSON).")
			.addText((t) =>
				t.setValue(data.profileFolder).onChange(async (v) => {
					data.profileFolder = v.trim() || "Graph profiles";
					await store.save();
				}),
			);
		new Setting(containerEl)
			.setName("Restore built-in profiles")
			.setDesc("Re-adds the shipped profiles and resets them to their original values. Your own profiles are kept.")
			.addButton((b) =>
				b.setButtonText("Restore").onClick(async () => {
					data.forces.restoreBuiltIns();
					data.views.restoreBuiltIns();
					await store.save();
					this.display();
				}),
			);

		new Setting(containerEl).setName("Behaviour").setHeading();
		new Setting(containerEl)
			.setName("Create notes from the graph")
			.setDesc("Clicking a note that doesn't exist yet creates it, like the core graph. When off, clicking only focuses it.")
			.addToggle((t) =>
				t.setValue(data.createOnGhostClick).onChange(async (v) => {
					data.createOnGhostClick = v;
					await store.save();
				}),
			);
		new Setting(containerEl)
			.setName("Search note content")
			.setDesc("Lets filters and colour groups match words inside notes (plain words, content:, line:). Turn off on very large vaults if building the graph feels slow.")
			.addToggle((t) =>
				t.setValue(data.contentQueries).onChange(async (v) => {
					data.contentQueries = v;
					await store.save();
				}),
			);

		new Setting(containerEl).setName("Performance").setHeading();
		new Setting(containerEl)
			.setName("Detail level")
			.setDesc("Automatic adapts labels, geometry, particles and glow to the size of the graph.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Automatic", quality: "Favour quality", performance: "Favour speed" })
					.setValue(data.performance.mode)
					.onChange(async (v) => {
						data.performance.mode = v as PerfMode;
						await store.save();
					}),
			);
		new Setting(containerEl)
			.setName("Physics location")
			.setDesc("Where the force simulation runs. Automatic moves it to a background worker for large graphs so panning and rotating stay smooth while the layout settles.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Automatic", worker: "Always in background", main: "Always on main thread" })
					.setValue(data.performance.physicsMode)
					.onChange(async (v) => {
						data.performance.physicsMode = v as PhysicsMode;
						await store.save();
					}),
			);
		new Setting(containerEl)
			.setName("Physics background threshold")
			.setDesc("Graph size (nodes + links ÷ 2) at which automatic physics moves to the background worker.")
			.addText((t) =>
				t.setValue(String(data.performance.physicsThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (!Number.isFinite(n) || n < 0) return;
					data.performance.physicsThreshold = Math.round(n);
					await store.save();
				}),
			);
		new Setting(containerEl)
			.setName("Background computation")
			.setDesc("Where second/third-level link maths runs. Automatic uses a background worker once the graph is large.")
			.addDropdown((d) =>
				d
					.addOptions({ auto: "Automatic", always: "Always in background", never: "Never (main thread)" })
					.setValue(data.performance.workerMode)
					.onChange(async (v) => {
						data.performance.workerMode = v as WorkerMode;
						await store.save();
					}),
			);
		new Setting(containerEl)
			.setName("Background computation threshold")
			.setDesc("Graph size (nodes + links ÷ 2) at which automatic mode computes indirect links in the background worker.")
			.addText((t) =>
				t.setValue(String(data.performance.workerThreshold)).onChange(async (v) => {
					const n = Number(v);
					if (!Number.isFinite(n) || n < 0) return;
					data.performance.workerThreshold = Math.round(n);
					await store.save();
				}),
			);
	}
}
