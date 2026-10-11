import { FuzzySuggestModal, Modal, Setting, type App, type TFile } from "obsidian";

/** Single-line text prompt. Resolves to null when cancelled. */
export function promptText(app: App, title: string, initial: string): Promise<string | null> {
	return new Promise((resolve) => {
		let value = initial;
		let done = false;
		const modal = new (class extends Modal {
			override onOpen() {
				this.titleEl.setText(title);
				new Setting(this.contentEl).addText((text) => {
					text.setValue(initial).onChange((v) => (value = v));
					text.inputEl.addEventListener("keydown", (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							finish(value);
						}
					});
					window.setTimeout(() => text.inputEl.select(), 0);
				});
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText("Cancel").onClick(() => finish(null)))
					.addButton((b) => b.setButtonText("OK").setCta().onClick(() => finish(value)));
			}
			override onClose() {
				if (!done) resolve(null);
			}
		})(app);
		const finish = (result: string | null) => {
			done = true;
			resolve(result && result.trim() ? result.trim() : null);
			modal.close();
		};
		modal.open();
	});
}

export function confirmAction(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		let done = false;
		const modal = new (class extends Modal {
			override onOpen() {
				this.contentEl.createEl("p", { text: message });
				new Setting(this.contentEl)
					.addButton((b) => b.setButtonText("Cancel").onClick(() => finish(false)))
					.addButton((b) => b.setButtonText("Continue").setWarning().onClick(() => finish(true)));
			}
			override onClose() {
				if (!done) resolve(false);
			}
		})(app);
		const finish = (ok: boolean) => {
			done = true;
			resolve(ok);
			modal.close();
		};
		modal.open();
	});
}

export function pickFile(app: App, files: TFile[], placeholder: string): Promise<TFile | null> {
	return new Promise((resolve) => {
		let chosen = false;
		const modal = new (class extends FuzzySuggestModal<TFile> {
			getItems() {
				return files;
			}
			getItemText(file: TFile) {
				return file.path;
			}
			onChooseItem(file: TFile) {
				chosen = true;
				resolve(file);
			}
			override onClose() {
				// onChooseItem fires after close; give it a tick before reporting a cancel.
				window.setTimeout(() => {
					if (!chosen) resolve(null);
				}, 50);
			}
		})(app);
		modal.setPlaceholder(placeholder);
		modal.open();
	});
}
