# Architecture

The plugin is split into layers with one-way dependencies. Everything except
`src/obsidian/` and `src/main.ts` is Obsidian-free. That means it can be
unit-tested in Node, run in the browser harness, and reused elsewhere.

```
src/
  core/                 pure logic — no DOM, no Obsidian
    graph/              model types, GraphBuilder, reference strength maths,
                        indirect (2nd/3rd-level) path counting, fingerprint
    query/              Obsidian search-syntax subset: parser + evaluator
    color/              colour groups, core graph.json reader
    forces/             ForceModule interface, registry, modules/*
    settings/           control specs, view settings schema, plugin data
    profiles/           generic ProfileLibrary, built-ins, core-graph mapping
    compute/            task registry, executors, the worker entry (tasks + physics)
    physics/            SimulationRunner: the force simulation detached from any renderer
    perf/               dynamic scaling plan (tiers, LOD, worker choice)
  renderers/            GraphRenderer interface, shared StyleResolver,
                        3d-force-graph + force-graph adapters, 3D label layer,
                        batched 3D link layer, label de-cluttering
  controller/           GraphPipeline (data stages), ForceCoordinator,
                        WorkerPhysics, GraphController (orchestration), ports
  ui/                   plain-DOM toolbar, side panel, schema-driven controls
  obsidian/             adapters: data source, host, view, settings tab, modals
  main.ts               plugin entry: view, commands, settings store
dev/harness/            browser harness with a synthetic vault
dev/e2e/                browser checks run against the harness (npm run e2e)
tests/                  vitest suites
```

## Data flow

```
GraphDataSource.snapshot()           (Obsidian metadata cache / mock vault)
        │
GraphPipeline.buildModel()           filters + search query → GraphModel
        │                            (reference counts, ghost nodes, tags)
GraphPipeline.applyColors()          colour-group queries → node.color / node.group
        │
GraphRenderer.setData()              3D or 2D, same node objects (positions survive)
        │
ForceCoordinator.applyForces()       small graphs: every ForceModule.apply() → renderer's d3 engine
  or WorkerPhysics.start()           large graphs: the same modules run in a worker
        │                            (SimulationRunner); positions stream back each frame
        │
GraphPipeline.augment()              async, maybe in a worker → indirect links
        └──────────► setData again + forces
```

`StyleResolver` is the single source of truth for colours, sizes, widths,
labels and highlight state. Both renderers read from it, which is why 2D and
3D look and behave the same. Label overlap is resolved per frame by
`declutter()` (screen-space boxes, highest `labelPriority` wins), so both views
share one rule for which labels survive.

The side panel's tabs and settings search are generated from the same control
specs as the sections, so a new force module or view setting is searchable
without extra code. Panel menus go through the `GraphHost.showMenu` port
(Obsidian's `Menu` in the plugin, a DOM stand-in in the harness).

## Extending

### Add a force

1. Create `src/core/forces/modules/myForce.ts` exporting a `ForceModule<MySettings>`:
   `id`, `label`, `description`, `defaults`, `controls` (declarative UI), `apply(ctx, settings)`.
   - Use `ctx.engine.setForce(name, force | null)` for d3 forces (custom ones get
     `initialize(nodes, random, dims)` so they work in 2D and 3D).
   - Use `ctx.setLinkPhysics(kind, { strength, distance })` to control how a link kind pulls.
   - Optionally add `augment()` + `augmentKey()` to contribute extra links (e.g. similarity links).
2. Add it to `FORCE_MODULES` in `src/core/forces/registry.ts`.

That's it. Its defaults are merged into every saved profile, and its controls
appear in the panel automatically.

### Add a display setting

Add the field to `ViewSettings` and `DEFAULT_VIEW_SETTINGS` in
`src/core/settings/view.ts`. Add a control to a `VIEW_SECTIONS` entry, then read
it in `StyleResolver` or a renderer. Old profiles pick up the default automatically
(`mergeWithDefaults`).

### Add a heavy computation

Write a pure function and register it in `TASKS` (`src/core/compute/tasks.ts`).
Call it through `ctx.compute(task, input)` from an augmenting module. The
executor decides between the main thread and the worker from the performance plan,
and falls back to the main thread if the worker fails.

### Add a renderer

Implement `GraphRenderer` (`src/renderers/types.ts`) and map a mode to it in
`src/renderers/factory.ts`.

### Run outside Obsidian

Implement the three ports in `src/controller/ports.ts` (`GraphDataSource`,
`GraphHost`, `SettingsStore`) and construct a `GraphController`.
`dev/harness/harness.ts` is a complete example.

## Scaling strategy

- `planPerformance()` maps graph load (nodes + links/2) to a tier
  (small → huge). It picks sphere detail, label budget, particles, bloom,
  arrows, cooling and default caps for indirect links. *Settings → Performance*
  can bias it towards quality or speed.
- Indirect links use compressed adjacency (typed arrays), a sparse accumulator
  per source node, a hub cap, a per-node partner limit, a global cap and a
  per-source work budget. Cost stays bounded on dense vaults. 20k nodes /
  80k links compute in about 0.5 s in tests.
- Large graphs run that computation in a Blob-URL Web Worker. The worker source
  is bundled into `main.js` by the `inline-compute-worker` esbuild plugin.
- **Physics** is the dominant cost on big graphs (d3's many-body force is
  O(n log n) per tick; about 200 ms per tick at 20k nodes). Past
  `physicsThreshold`, `WorkerPhysics` runs the force simulation in its own
  worker using the same `FORCE_MODULES`. The renderer's engine keeps "ticking"
  with a single sync force that copies the newest positions, so rendering stays
  at full frame rate. Dragging and pinning are mirrored into the worker. If the
  worker fails, the view falls back to main-thread physics.
- Nothing runs synchronous warm-up ticks, so opening a huge graph never freezes the UI.
- In 3D, large tiers draw ordinary links as one `LineSegments` batch
  (`LinkBatch3D`) instead of one object per link. Highlighted links are still
  drawn individually so they can be thick.
- Next steps if needed: an instanced node layer (one draw call for all
  spheres) and a typed-array Barnes–Hut many-body force.
- `modelFingerprint()` skips re-pushing data, so physics doesn't re-heat when an
  edit changed note text but not links or colours.
