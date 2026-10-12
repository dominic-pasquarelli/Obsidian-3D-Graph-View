# 3D Graph View for Obsidian

A modular, highly configurable graph view for Obsidian. Explore your vault as a
**3D or 2D force graph** where the physics reflect how your notes actually relate.
It's built for neural-map style exploration and recall.

## Features

| Feature | What it does |
| --- | --- |
| **3D and 2D views** | WebGL 3D view and canvas 2D view. Both run the *same* force modules and style rules, so switching keeps the layout logic identical. 2D/3D is a per-tab choice: each tab remembers its mode, and switching profiles never flips it. |
| **Reference-weighted pull** | Writing `[[B]]` five times in note A makes A↔B a stronger, shorter spring than a single mention. Choose linear / square-root / logarithmic scaling, its influence on pull and distance, and how two-way links combine. |
| **Notes that don't exist yet** | Unresolved links show as hollow "ghost" nodes. Click one to create the note (optional). The new note keeps the ghost's position. |
| **Second & third-level gravity** | If A→B→D and A→C→D, D shows up twice as a 2nd-level link of A. Pairs reached through enough 2- or 3-step paths pull towards each other. You can follow link direction or ignore it, which also catches notes that link to the same things. Each level has its own threshold and strength, plus a hub cap and a per-note partner limit. |
| **Import colour groups** | Use the core graph's colour groups live, or copy them into a profile and edit them. Its filters and forces can be imported too. Queries support `tag:`, `path:`, `file:`, `content:`, `line:`, `section:`, `[property:value]`, words, `"phrases"`, `/regex/`, `OR`, `-negation` and `( )`. |
| **Colour-group gravity** | Notes in the same colour group attract each other, so your classification forms visible regions. |
| **Force & view profiles** | Two independent profile libraries: *force* (physics) and *view* (filters, colours, display). Mix and match them, save, save as, rename, revert, delete, and export/import as JSON files in your vault. |
| **Recall-friendly interaction** | Hover to highlight a note's neighbourhood and dim everything else. Ctrl/Cmd-hover shows a page preview. The active note is highlighted. You can search and fly to a note, pin nodes, and use the right-click menu (including other plugins' file actions). |
| **Scales dynamically** | Detail level (labels, geometry, particles, glow, arrows, link opacity) adapts to graph size. On large graphs the **whole force simulation runs in a background worker** (same force modules), so panning and rotating stay smooth while the layout settles. Indirect-link maths moves to the worker too, and 3D links are drawn in one batch. Edits that don't change links don't disturb the layout. |

## Using it

- **Ribbon icon** or the command palette: *Open 3D graph*, *Open 2D graph*, *Switch between 2D and 3D*, *Show active note in graph*.
- The **sliders icon** in the view's toolbar opens the settings panel: profiles, every force module, display sections and colour groups.
- **Click** a node to open it (Ctrl/Cmd-click opens it in a new tab). **Right-click** for more actions.
- Global options (default profiles, profile folder, performance, content search) are in *Settings → 3D Graph View*.

### Built-in profiles

- **Force:** *Balanced*, *Reference clusters* (strong reference weighting), *Neural* (indirect gravity + group gravity), *Colour-group regions*.
- **View:** *Default*, *Neural glow* (space background, bloom, signal particles, indirect links visible), *Recall* (labels only on hover).

Built-ins can be edited or deleted. *Settings → Restore built-in profiles* brings them back.

## Installing

Desktop only. Turn on community plugins first (*Settings → Community plugins*).

### With BRAT (recommended while the plugin is in beta — updates automatically)

1. In *Settings → Community plugins → Browse*, install and enable **BRAT**.
2. Run the command **BRAT: Add a beta plugin for testing** and enter `dominic-pasquarelli/Obsidian-3D-Graph-View`.
3. Enable **3D Graph View** in *Settings → Community plugins*.

BRAT installs the latest [release](https://github.com/dominic-pasquarelli/Obsidian-3D-Graph-View/releases) and picks up new ones on startup.

### Manually

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release (or build them: `npm install && npm run build`).
2. Put them in `<vault>/.obsidian/plugins/3d-graph-view/`. *Settings → Community plugins* has a folder button that opens `.obsidian/plugins` for you.
3. Click the reload button next to *Installed plugins*, then enable **3D Graph View**.

### Publishing a release (maintainers)

`npm version <x.y.z>` updates `package.json`, `manifest.json` and `versions.json`. Push to `main`,
then on GitHub publish a release whose new tag is exactly that version (no `v`). The
**Release** workflow builds, tests and attaches the three files.

## Development

```bash
npm install
npm run dev          # watch build of main.js
npm test             # unit + integration tests (vitest)
npm run typecheck
npm run harness      # serves the browser harness at http://localhost:8123
npm run e2e          # builds the harness and runs browser checks (needs `npx playwright install chromium`)
```

The **harness** (`dev/harness`) runs the real graph controller against a
synthetic vault in a normal browser, so most work doesn't need Obsidian. Query
params: `?n=5000&mode=2d&worker=always&physics=worker&reset=1&panel=0`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the module map and how
to add forces, settings, renderers or background tasks.
