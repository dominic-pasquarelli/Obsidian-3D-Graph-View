import esbuild from "esbuild";
import { builtinModules } from "node:module";

/**
 * Build modes:
 *   node esbuild.config.mjs              -> watch build of main.js (dev)
 *   node esbuild.config.mjs production   -> minified main.js
 *   node esbuild.config.mjs harness      -> builds + serves the browser harness (dev/harness)
 *   node esbuild.config.mjs harness-build-> builds the harness only (used for automated checks)
 */
const mode = process.argv[2] ?? "dev";
const prod = mode === "production";

const banner = `/*
3D Graph View — bundled by esbuild. Source: https://github.com/dominic-pasquarelli/Obsidian-3D-Graph-View
*/`;

/** Bundles the compute worker to a string so it can be spawned from a Blob URL (single-file plugin). */
async function buildWorkerSource() {
	const result = await esbuild.build({
		entryPoints: ["src/core/compute/worker.ts"],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		minify: prod,
		logLevel: "silent",
	});
	return result.outputFiles[0].text;
}

/** Resolves `import src from "virtual:compute-worker"` to the bundled worker source string. */
const inlineWorkerPlugin = {
	name: "inline-compute-worker",
	setup(build) {
		build.onResolve({ filter: /^virtual:compute-worker$/ }, (args) => ({ path: args.path, namespace: "compute-worker" }));
		build.onLoad({ filter: /.*/, namespace: "compute-worker" }, async () => ({
			contents: `export default ${JSON.stringify(await buildWorkerSource())};`,
			loader: "js",
			watchFiles: [],
		}));
	},
};

const pluginOptions = {
	banner: { js: banner },
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	minify: prod,
	outfile: "main.js",
	plugins: [inlineWorkerPlugin],
};

const harnessOptions = {
	entryPoints: ["dev/harness/harness.ts"],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	sourcemap: "inline",
	outfile: "dev/harness/dist/harness.js",
	logLevel: "info",
	plugins: [inlineWorkerPlugin],
};

if (mode === "harness" || mode === "harness-build") {
	if (mode === "harness-build") {
		await esbuild.build(harnessOptions);
	} else {
		const ctx = await esbuild.context(harnessOptions);
		await ctx.watch();
		const { port } = await ctx.serve({ servedir: "dev/harness", port: 8123 });
		console.log(`Harness running at http://localhost:${port}/`);
	}
} else if (prod) {
	await esbuild.build(pluginOptions);
} else {
	const ctx = await esbuild.context(pluginOptions);
	await ctx.watch();
}
