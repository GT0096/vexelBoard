<p align="center">
  <img src="resources/logo.svg" alt="Vexelboard Logo" width="88" />
</p>

<h1 align="center">Vexelboard</h1>

<p align="center">
  <strong>AI-powered interactive whiteboard &amp; study studio for Windows, macOS, and Linux.</strong>
</p>

<p align="center">
  <a href="https://github.com/GT0096/vexelBoard/releases/latest"><img src="https://img.shields.io/github/v/release/GT0096/vexelBoard?label=Download%20Latest&style=for-the-badge&color=FF5E5B&labelColor=111111" alt="Download Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-FFE566?style=for-the-badge&labelColor=111111" alt="Apache 2.0 License" /></a>
  <img src="https://img.shields.io/badge/Electron-44-67E8F9?style=for-the-badge&labelColor=111111" alt="Electron 44" />
  <img src="https://img.shields.io/badge/React-19-7BF1A8?style=for-the-badge&labelColor=111111" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-C4B5FD?style=for-the-badge&labelColor=111111" alt="TypeScript 5" />
</p>

**Vexelboard** is an AI-powered, interactive desktop whiteboard and study studio built with **Electron**, **React**, **TypeScript**, and **Vite** in a bold **Neo-Brutalist** interface.

It combines an infinite drawing canvas, background-adaptive color palettes, diagrams and shape libraries, Markdown & LaTeX notes, interactive **2D & 3D Graph Cards** (`16` chart types) and **3D Scenes**, an embedded multi-language Code Studio with **visual Code Pipelines**, playable YouTube study cards, a local **Knowledge Studio** backed by SQLite + vector search with `@book` chat citations and project-wide context, flexible AI integrations (local Ollama or BYOK cloud providers), and a local **MCP Companion Server** for Antigravity and Claude.

> New to Vexelboard? Read the full **[Functional User Guide](wiki/User-Guide.md)** for step-by-step workflows and shortcuts.

---

## Features

- **Infinite Whiteboard & Adaptive Palettes**: Smooth pan/zoom canvas with Solid, Dot Matrix, or Graph Grid backgrounds, automatic background-adaptive color palettes for ink, text, shapes, React Flow diagrams, and SVG exports, plus a **responsive floating bottom toolbar** (`Select`, `Pan`, `Pen · Shapes`, `Lasso`, `Text`, `Image`, `Vectorize`, `Hand`, `Erase`, `Bg`, zoom, undo/redo) that adapts cleanly across narrow and wide windows.
- **Pen & Writing Pad Tools**:
  - **5 Pen Types**: `Ballpoint`, `Fountain`, `Marker`, `Highlight`, and `Dashed` — available in both the left dock Pen flyout and the bottom `Pad` popover.
  - **Color & Thickness**: Theme ink/accent swatches, palette-matched colors, custom color picker, and `1px–24px` stroke thickness.
  - **Eraser Modes**: Continuous Paper Eraser (`10px–160px`) and Section Delete box selection.
  - **Writing Pad OCR**: Optional freehand-to-text and freehand-to-LaTeX-equation conversion.
  - **Full History**: Multi-step Undo (`Ctrl+Z`) and Redo (`Ctrl+Y` / `Ctrl+Shift+Z`).
- **Shapes, Stickies & AI Beautify**: Extensive SVG shape library, animated connectors, sticky notes, one-click diagram templates, and AI-powered **Beautify** to turn hand-drawn sketches into interactive React Flow diagrams.
- **Interactive 2D & 3D Graph Cards & 3D Scenes**:
  - **Unified Plotly/GeoGebra Graph Cards**: Movable, resizable cards supporting **16 chart types**: `function`, `line`, `smooth`, `area`, `bar`, `histogram`, `scatter`, `pie`, `violin`, `box`, `candlestick`, `heatmap`, `surface3d`, `scatter3d`, `line3d`, and `bar3d`.
  - **Customize Drawer & Controls**: Built-in color palettes, per-series/slice colors, axis/grid/background/text colors, axis styles (`origin`, `frame`, `box`, `none`), legend positions (`bottom`, `top`, `right`, `inside`), 2D hover tooltips/zoom/pan/reset, and 3D **Orbit / Move (Pan)** mode toggle (`Shift+Drag` / right-drag / middle-drag) with **Center & Reset**.
  - **3D Scenes**: Canvas-immersed interactive 3D object & experimental setup cards (presets + custom primitives), plus inline ```` ```3d ```` blocks inside Markdown notes.
- **Code Studio, Visual Code Pipelines & Video Cards**:
  - **Code Cards**: Movable, resizable code containers on the canvas with CodeMirror editing and local execution across **16 runnable languages** (`Python`, `JavaScript`, `TypeScript`, `C++`, `C`, `Java`, `Go`, `Rust`, `R`, `Ruby`, `PHP`, `C#`, `PowerShell`, `Bash`, `Lua`, `Perl`) plus live `HTML / CSS / JS` browser preview (`src/main/codeRunner.ts`).
  - **Visual Code Pipelines**: Click or drag any Code Card's cyan connector dot to chain `Code → Code → Graph` or `Code → 3D Scene` stages with non-overlapping placement and automatic re-execution on connect. Features zero-boilerplate Python auto-emit/auto-receive (`x = [...]; y = [...]`, `def transform(data):`, `INPUT`/`DATA`/`PREV`, or clean `sys.stdin`), cross-language `stdout → stdin` piping across all 16 languages, and an inline **`Guide`** drawer with 3-step instructions and 1-click stage templates.
  - **YouTube Video Cards**: Embed videos directly on the canvas with timestamped bookmarks and notes.
- **Antigravity & Claude Companion (MCP & Agent Skills)**:
  - Local HTTP/MCP server (`http://127.0.0.1:45789/mcp`) in `src/main/companionServer.ts` lets external agents inspect the active board and create/update notes, diagrams, vector scenes, 2D/3D graphs (`vexelboard_create_graph`), 3D scenes (`vexelboard_create_3d_scene`), code cards (`vexelboard_add_code_card`), and live pipeline connectors (`vexelboard_connect_elements`).
  - Bundled workspace skills under `.agents/skills/vexelboard-canvas` (`vexel.mjs` CLI with `add-graph` & `add-pipeline`) and `.agents/skills/vexelboard-knowledge`.
- **Knowledge Studio & `@` Book Citations**:
  - Index `.pdf`, `.txt`, `.md`, code files, YouTube transcripts, and whiteboard snapshots into local SQLite (`better-sqlite3` with automatic `node:sqlite` fallback) + `sqlite-vec` hybrid FTS5/vector RAG.
  - Generate **Study Guides**, **FAQ & Quizzes**, **Podcast Scripts**, **Visual Tutorials**, and **Board Recall** analyses.
  - Pin specific books or notes directly inside Chat via the **`Books` picker** or **`@` autocomplete** to strictly ground answers in that book, and toggle **Project Context** to let the AI refer to materials across all sections in the project.
- **Projects, Sections & Multi-Screen AI Chat**: Organize creativity into **Projects** and topic **Sections**, keep multiple persistent chat threads per project, or pop chat out into an always-on-top window for multi-monitor workflows.
- **Flexible AI Providers**: Connect locally to **Ollama** or bring your own API key (**OpenAI**, **Google Gemini**, **xAI Grok**, **Anthropic Claude**) stored encrypted with Electron `safeStorage`.
- **Optional Hand Gesture Control**: Local MediaPipe Tasks Vision (`public/mediapipe`) hand-tracking support.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Desktop Shell** | Electron 44, `electron-vite`, `electron-builder` |
| **Frontend UI** | React 19, TypeScript, Lucide Icons, Neo-Brutalist CSS |
| **Canvas & Diagrams** | HTML5 Canvas (`perfect-freehand`), `@xyflow/react`, `dagre`, Mermaid, KaTeX |
| **Code Editor** | `@uiw/react-codemirror` |
| **Local Storage & RAG** | `better-sqlite3` / `node:sqlite`, `sqlite-vec`, `pdf-parse` |
| **Vision** | `@mediapipe/tasks-vision` |

---

## Project Structure

```text
vexelboard/
├── .agents/skills/           # Bundled Antigravity & Claude skills (vexelboard-canvas, vexelboard-knowledge) & vexel.mjs CLI
├── build/                    # App icons (.ico, .icns, .png), NSIS installer hook (installer.nsh), macOS setup, entitlements
├── public/
│   ├── favicon.svg           # Vexelboard Kinetic V Nib SVG favicon
│   └── mediapipe/            # Offline MediaPipe WASM & hand-tracking assets
├── resources/                # Unpacked runtime assets (logo.svg, icon.png, icon.ico)
├── scripts/                  # Codegen scripts (e.g., generate-shape-library.mjs)
├── src/
│   ├── main/                 # Electron main process, IPC, SQLite DB, LLM router, code runner, MCP companionServer.ts
│   ├── preload/              # Context-isolated preload API bridge
│   ├── shared/               # Shared IPC, provider, and agent mutation schemas
│   └── renderer/
│       ├── index.html        # App entry HTML & CSP
│       └── src/
│           ├── board/        # Board state/undo-redo, graph plot builder, pipeline parser, agent executor, palettes, export, store
│           ├── components/   # Toolbar, Left Dock, CanvasGraphCard, Canvas3DScene, Code Studio, Knowledge Hub, Diagrams, Chat
│           ├── shapes/       # Shape library catalog & SVG renderer
│           ├── types/        # Whiteboard domain types
│           └── vision/       # MediaPipe webcam hand-tracking engine
├── wiki/                     # Functional User Guide (wiki/User-Guide.md)
├── electron-builder.yml      # Windows (NSIS), macOS (DMG/ZIP), Linux packaging config
├── electron.vite.config.ts   # Main, preload, and renderer Vite configuration
├── LICENSE                   # Apache License 2.0
└── package.json
```

---

## Installation & Development

### Prerequisites

- **Node.js** `>= 20` and **npm**
- *(Optional)* **Ollama** running locally (`http://localhost:11434`) for local AI inference, or an API key for OpenAI / Gemini / Grok / Claude (configured inside **AI Settings**).
- *(Optional)* Local compilers/interpreters (`python`, `node`, `javac`/`java`, `go`, etc.) if executing snippets in Code Studio.

### Setup & Run Locally

```bash
# 1. Clone the repository
git clone https://github.com/GT0096/vexelBoard.git
cd vexelBoard

# 2. Install dependencies
npm install

# 3. Start Electron in development mode (with hot reload)
npm run dev
```

### Other Useful Scripts

```bash
npm run typecheck         # Type-check main/preload (node) and renderer (web)
npm run lint              # Run ESLint across the repository
npm run format            # Format code with Prettier
npm run build             # Type-check + build production bundles into out/
npm start                 # Preview the production build locally
```

---

## Building Desktop Executables & Installers

Packaging is configured via [electron-builder.yml](electron-builder.yml) and outputs installers into `dist/`.

### Windows (`.exe` Installer)

```bash
npm run build:win
```

Produces:

- `dist/Vexelboard-<version>-Setup.exe` — Interactive NSIS installer (customizable install directory, Desktop & Start Menu shortcuts, Windows `App Paths` + `PATH` registration for Windows Search / `Win + R` / terminal launch, in-place update or uninstall option when already installed, auto-launch on finish).
- `dist/win-unpacked/Vexelboard.exe` — Standalone unpacked Windows executable.

### macOS (`.dmg` & `.zip`)

Run on a macOS machine:

```bash
npm run build:mac
# Or build a single universal binary:
npm run build:mac:universal
```

Produces Apple Silicon (`arm64`) and Intel (`x64`) installers in `dist/`:

- `Vexelboard-<version>-arm64.dmg` & `Vexelboard-<version>-x64.dmg` — Drag-and-drop **Vexelboard.app** into `/Applications`, or run **`Update or Uninstall Vexelboard.command`** inside the DMG to install, update in place, or uninstall.
- `Vexelboard-<version>-arm64.zip` & `Vexelboard-<version>-x64.zip`

> **Building `.dmg` from Windows or CI:** Apple's `.dmg` packager only runs on macOS. You can build macOS installers automatically on GitHub Actions using [release.yml](.github/workflows/release.yml) (**Actions → Release Installers → Run workflow**, or push a `v*` tag). For unsigned builds on macOS Gatekeeper, right-click **Vexelboard.app → Open** (or run `xattr -cr /Applications/Vexelboard.app`) on first launch.

### Linux (`AppImage` & `deb`)

```bash
npm run build:linux
```

### Unpacked Directory Only

```bash
npm run build:unpack
```

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `V` | Select tool |
| `H` or hold `Space` + Drag | Pan canvas |
| `P` | Pen drawing tool |
| `T` | Text / Markdown note tool |
| `E` | Eraser tool |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+B` / `Cmd+B` | Beautify selected sketch into diagram |
| `Ctrl+0` / `Cmd+0` | Reset zoom to `100%` |
| `Shift+1` | Fit board view to content |
| `Arrow Keys` (`+ Shift` for 10px) | Nudge selected elements |
| `Delete` / `Backspace` | Delete selected elements |
| `Escape` | Clear selection |

---

## Contributing

Contributions are welcome! Please read [contribution.md](contribution.md) before opening a pull request.

---

## License

This project is licensed under the [Apache License 2.0](LICENSE).
