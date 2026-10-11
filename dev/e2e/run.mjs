/**
 * End-to-end checks for the graph view, run against the browser harness.
 *
 *   npm run e2e                 # builds the harness, serves it, runs every check
 *   CHROMIUM_PATH=/path/to/chrome npm run e2e   # use a specific Chromium build
 *   E2E_SHOTS=./shots npm run e2e               # also save screenshots
 *
 * Requires `playwright` (dev dependency) and a Chromium: `npx playwright install chromium`.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../harness/", import.meta.url));
const SHOTS = process.env.E2E_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- tiny static server for dev/harness
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
	const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
	const file = path.endsWith("/") ? join(path, "index.html") : path;
	if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
		res.writeHead(404).end();
		return;
	}
	res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
	createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}/index.html`;

const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined,
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
let failures = 0;
const errors = [];
const check = (label, cond, extra = "") => {
	if (!cond) failures++;
	console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? `  (${extra})` : ""}`);
};

async function open(query) {
	const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
	page.on("pageerror", (e) => errors.push(`${query}: ${e.stack ?? e.message}`));
	page.on("console", (m) => m.type() === "error" && errors.push(`${query}: ${m.text()}`));
	page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "My test profile" : undefined));
	await page.goto(`${BASE}?reset=1&${query}`);
	await page.waitForFunction(() => window.harness?.controller.debugState().model, null, { timeout: 60000 });
	page.H = (fn, arg) => page.evaluate(fn, arg);
	return page;
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: join(SHOTS, `${name}.png`) });
const nodeAt = (page, id) => page.H((id) => window.harness.controller.screenPosition(id), id);
const node = (page, id) => page.H((id) => { const n = window.harness.controller.debugState().model.nodeById.get(id); return { x: n.x, y: n.y, fx: n.fx }; }, id);
const spread = (page) => page.H(() => { const xs = window.harness.controller.debugState().model.nodes.map((n) => n.x); return Math.max(...xs) - Math.min(...xs); });
const physicsOn = async (page) => (await page.H(() => window.harness.controller.statusLines())).find((l) => l.startsWith("Physics runs on"));
const toggle = (page, section, key) => page.locator(`[data-section="${section}"] input[data-key="${key}"]`).locator("..").click();

// ---------------------------------------------------------------- 1. modes and profiles render
{
	const page = await open("n=400");
	await page.waitForTimeout(3000);
	const s = await page.H(() => window.harness.controller.debugState());
	check("3D view builds the model", s.model.nodes.length > 400 && s.model.stats.unresolved > 0);
	await shot(page, "01-3d");
	await page.locator(".g3d-toolbar-profile select").nth(0).selectOption({ label: "Neural (indirect gravity)" });
	await page.locator(".g3d-toolbar-profile select").nth(1).selectOption({ label: "Neural glow" });
	await page.waitForTimeout(3000);
	check("neural profile computes indirect links", (await page.H(() => window.harness.controller.debugState().extraLinks.length)) > 0);
	await shot(page, "02-3d-neural");
	await page.locator(".g3d-segmented button", { hasText: "2D" }).click();
	await page.waitForTimeout(3000);
	check("2D view keeps the same model", (await page.H(() => window.harness.controller.debugState().view.mode)) === "2d");
	await shot(page, "03-2d-neural");
	// Profiles never flip the tab's 2D/3D choice (Recall was saved from a 3D tab).
	await page.locator(".g3d-toolbar-profile select").nth(1).selectOption({ label: "Recall (labels on hover)" });
	await page.waitForTimeout(800);
	check("switching view profile keeps the tab in 2D", (await page.H(() => window.harness.controller.debugState().view.mode)) === "2d");
	await page.close();
}

// ---------------------------------------------------------------- 2. interaction, profiles, colours, filters
{
	const page = await open("n=150&mode=2d");
	await page.waitForTimeout(4000);
	const hub = "Index.md";
	let pos = await nodeAt(page, hub);
	await page.mouse.move(pos.x, pos.y);
	await page.waitForTimeout(300);
	check("hover highlights the node", (await page.H(() => window.harness.controller["style"].hovered)) === hub);
	await page.mouse.click(pos.x, pos.y);
	await page.waitForTimeout(250);
	let last = await page.H(() => window.harness.log.at(-1));
	check("click opens the note", last?.type === "open" && last.detail.id === hub);
	pos = await nodeAt(page, hub);
	await page.mouse.click(pos.x, pos.y, { button: "right" });
	await page.waitForTimeout(250);
	last = await page.H(() => window.harness.log.at(-1));
	check("right-click shows the node menu", last?.type === "menu", JSON.stringify(last));
	await page.keyboard.press("Escape");
	await page.mouse.click(5, 300);
	await page.waitForTimeout(250);
	const ghost = await page.H(() => window.harness.controller.debugState().model.nodes.find((n) => n.kind === "unresolved").id);
	pos = await nodeAt(page, ghost);
	await page.mouse.click(pos.x, pos.y);
	await page.waitForTimeout(250);
	last = await page.H(() => window.harness.log.at(-1));
	check("clicking a not-yet-created note creates it", last?.type === "open" && last.detail.kind === "unresolved", JSON.stringify(last));

	await page.locator("summary", { hasText: "Second & third-level gravity" }).click();
	await toggle(page, "force:indirect", "enabled");
	await page.waitForTimeout(1200);
	const directed = await page.H(() => window.harness.controller.debugState().extraLinks.length);
	check("enabling indirect gravity adds links", directed > 0, `links=${directed}`);
	await toggle(page, "force:indirect", "directed");
	await page.waitForTimeout(1200);
	const undirected = await page.H(() => window.harness.controller.debugState().extraLinks.length);
	check("ignoring direction finds more partners", undirected > directed, `${directed} -> ${undirected}`);

	// Regression: a text-only vault event while indirect links compute must not discard them.
	const survived = await page.H(async () => {
		const c = window.harness.controller;
		c.debugState().model.extraLinks = [];
		const pending = c["refreshAugment"](true);
		window.harness.touch();
		await pending;
		await new Promise((r) => setTimeout(r, 300));
		return c.debugState().extraLinks.length;
	});
	check("indirect links survive a text-only vault event mid-computation", survived > 0, `links=${survived}`);

	const forceProfile = page.locator(".g3d-profile").first();
	await forceProfile.locator("button", { hasText: "Save as…" }).click();
	await page.waitForTimeout(400);
	check("save as creates a profile", (await page.H(() => window.harness.store.data.forces.list().map((p) => p.name))).includes("My test profile"));
	await forceProfile.locator("button", { hasText: "Export" }).click();
	await forceProfile.locator("button", { hasText: "Import" }).click();
	await page.waitForTimeout(400);
	check("export + import round-trips", (await page.H(() => window.harness.store.data.forces.list().map((p) => p.name))).includes("My test profile 2"));

	await page.locator(".g3d-segmented button", { hasText: "3D" }).click();
	await page.waitForTimeout(2000);
	check("2D/3D switch does not dirty the view profile", (await page.locator(".g3d-profile").nth(1).locator(".g3d-dirty").count()) === 0);

	await page.locator("summary", { hasText: "Colour groups" }).click();
	await page.locator('[data-section="colors"] button', { hasText: "Colour groups" }).click();
	await page.waitForTimeout(500);
	check("core colour groups import into the profile", (await page.H(() => window.harness.controller.debugState().view.colors.groups.length)) === 4);

	await page.H(() => (document.querySelector('[data-section="view:filters"]').open = true));
	const search = page.locator('[data-section="view:filters"] input[data-key="filters.search"]');
	await search.fill("tag:#neuro");
	await search.press("Enter");
	await search.blur();
	await page.waitForTimeout(1200);
	check("search filter limits notes", await page.H(() => window.harness.controller.debugState().model.nodes.filter((n) => n.kind === "note").every((n) => n.tags.includes("neuro"))));
	await page.close();
}

// ---------------------------------------------------------------- 3. background physics (2D + 3D)
for (const mode of ["2d", "3d"]) {
	const page = await open(`n=300&panel=0&mode=${mode}&physics=worker`);
	await page.waitForTimeout(3500);
	check(`${mode}: physics runs in the worker`, (await physicsOn(page)) === "Physics runs on: worker thread");
	const before = await spread(page);
	check(`${mode}: worker positions reach the renderer`, before > 50);
	const hub = "Index.md";
	const start = await node(page, hub);
	const p = await nodeAt(page, hub);
	await page.mouse.move(p.x, p.y);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(p.x + i * 12, p.y + i * 8);
		await page.waitForTimeout(30);
	}
	await page.mouse.up();
	await page.waitForTimeout(1200);
	const end = await node(page, hub);
	check(`${mode}: dragging works with worker physics`, Math.hypot(end.x - start.x, end.y - start.y) > 5);
	await page.H(() => window.harness.controller.onForceChange("charge", { key: "repel", value: 300, final: true }));
	await page.waitForTimeout(2500);
	check(`${mode}: live settings reach the worker`, (await spread(page)) > before * 1.2);
	await page.H(async () => {
		window.harness.store.data.performance.physicsMode = "main";
		await window.harness.store.save();
	});
	await page.waitForTimeout(800);
	check(`${mode}: physics can move back to the main thread`, (await physicsOn(page)) === "Physics runs on: main thread");
	await shot(page, `10-worker-${mode}`);
	await page.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join("\n"));
await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
