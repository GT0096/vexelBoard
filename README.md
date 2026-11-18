<p align="center">
  <img src="resources/logo.svg" width="88" alt="Vexelboard Logo" />
</p>

<h1 align="center">Vexelboard</h1>

<p align="center">
  <strong>AI-powered interactive whiteboard &amp; study studio for Windows, macOS, and Linux.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-FFE566?style=for-the-badge&labelColor=111111" alt="Apache 2.0 License" /></a>
  <img src="https://img.shields.io/badge/Electron-44-67E8F9?style=for-the-badge&labelColor=111111" alt="Electron 44" />
  <img src="https://img.shields.io/badge/React-19-7BF1A8?style=for-the-badge&labelColor=111111" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5-C4B5FD?style=for-the-badge&labelColor=111111" alt="TypeScript 5" />
</p>

**Vexelboard** is an AI-powered, interactive desktop whiteboard and study studio built with **Electron**, **React**, **TypeScript**, and **Vite** in a bold **Neo-Brutalist** interface.

It combines an infinite drawing canvas, background-adaptive color palettes, diagrams and shape libraries, Markdown & LaTeX notes, an embedded multi-language Code Studio, playable YouTube study cards, a NotebookLM-style local knowledge hub backed by SQLite + vector search with `@book` chat citations and project-wide context, and flexible AI integrations (local Ollama or BYOK cloud providers).

---

## Features

- **Infinite Whiteboard & Adaptive Palettes**: Smooth pan/zoom canvas with Solid, Dot Matrix, or Graph Grid backgrounds and automatic background-adaptive color palettes for ink, text, shapes, React Flow diagrams, and SVG exports.
- **Pen & Writing Pad Tools**:
  - **5 Pen Types**: `Ballpoint`, `Fountain`, `Marker`, `Highlight`, and `Dashed` — available in both the left dock Pen flyout and the bottom `Pad` popover.
  - **Color & Thickness**: Theme ink/accent swatches, palette-matched colors, custom color picker, and `1px–24px` stroke thickness.
  - **Eraser Modes**: Continuous Paper Eraser (`10px–160px`) and Section Delete box selection.
  - **Writing Pad OCR**: Optional freehand-to-text and freehand-to-LaTeX-equation conversion.
  - **Full History**: Multi-step Undo (`Ctrl+Z`) and Redo (`Ctrl+Y` / `Ctrl+Shift+Z`).
- **Shapes, Stickies & AI Beautify**: Extensive SVG shape library, animated connectors, sticky notes, one-click diagram templates, and AI-powered **Beautify** to turn hand-drawn sketches into interactive React Flow diagrams.
- **Code Studio & Video Cards**:
  - **Code Cards**: Movable, resizable code containers on the canvas with CodeMirror editing and local code execution (`src/main/codeRunner.ts`).
  - **YouTube Video Cards**: Embed videos directly on the canvas with timestamped bookmarks and notes.
- **NotebookLM Knowledge Hub & `@` Book Citations**:
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
├── build/                    # App icons (.ico, .icns, .png), NSIS installer hook (installer.nsh), entitlements
├── public/
│   ├── favicon.svg           # Vexelboard Kinetic V Nib SVG favicon
│   └── mediapipe/            # Offline MediaPipe WASM & hand-tracking assets
├── resources/                # Unpacked runtime assets (logo.svg, icon.png, icon.ico)
├── scripts/                  # Codegen scripts (e.g., generate-shape-library.mjs)
├── src/
│   ├── main/                 # Electron main process, IPC, SQLite DB, LLM router, code runner
│   ├── preload/              # Context-isolated preload API bridge
│   ├── shared/               # Shared IPC & provider types
│   └── renderer/
│       ├── index.html        # App entry HTML & CSP
│       └── src/
│           ├── board/        # Board state/undo-redo, rendering, palettes, eraser, export, store
│           ├── components/   # Toolbar, Left Dock, Settings, Code Studio, Knowledge Hub, Diagrams, Chat
│           ├── shapes/       # Shape library catalog & SVG renderer
│           ├── types/        # Whiteboard domain types
│           └── vision/       # MediaPipe webcam hand-tracking engine
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
git clone https://github.com/<your-username>/vexelboard.git
cd vexelboard

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
- `dist/Vexelboard-<version>-Setup.exe` — Interactive NSIS installer (customizable install directory, Desktop & Start Menu shortcuts, Windows `App Paths` + `PATH` registration for Windows Search / `Win + R` / terminal launch, Windows uninstall entry, auto-launch on finish).
- `dist/win-unpacked/Vexelboard.exe` — Standalone unpacked Windows executable.

### macOS (`.dmg` & `.zip`)

Run on a macOS machine:

```bash
npm run build:mac
# Or build a single universal binary:
npm run build:mac:universal
```

Produces Apple Silicon (`arm64`) and Intel (`x64`) installers in `dist/`:
- `Vexelboard-<version>-<arch>.dmg` — Drag-and-drop **Vexelboard.app** into `/Applications`.
- `Vexelboard-<version>-<arch>.zip`

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
