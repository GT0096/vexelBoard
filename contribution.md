# Contributing to Vexelboard

Thank you for contributing to **Vexelboard**! Whether you are fixing bugs, improving the Neo-Brutalist UI, adding canvas/diagram features, or improving documentation, this guide outlines how to set up your environment and submit changes cleanly.

---

## Getting Started

1. **Fork & Clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/vexelboard.git
   cd vexelboard
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Create a feature or fix branch**:
   ```bash
   git checkout -b feat/your-feature-name
   ```
4. **Run the app locally**:
   ```bash
   npm run dev
   ```

---

## Codebase Architecture

- `src/main/`: Electron main process, `BrowserWindow` lifecycle, IPC handlers (`index.ts`), SQLite/vector database (`db.ts`), LLM routing & key encryption (`llmRouter.ts`), media parsing (`mediaService.ts`), and local snippet execution (`codeRunner.ts`).
- `src/preload/`: Context-isolated preload script exposing typed APIs to the renderer.
- `src/shared/`: Shared TypeScript types across main, preload, and renderer (`ipc.ts`).
- `src/renderer/src/board/`: Whiteboard state and history (`useBoard.ts`), canvas stroke/shape renderer (`render.ts`), color palettes (`backgroundPresets.ts`), eraser math (`eraserUtils.ts`), SVG/image export (`exportUtils.ts`), and workspace storage (`workspaceStore.ts`).
- `src/renderer/src/components/`: UI components (`App.tsx`, `TopBar.tsx`, `MiroLeftToolbar.tsx`, `Toolbar.tsx`, `PenControls.tsx`, `HomeHub.tsx`, `SettingsModal.tsx`, `ReactFlowDiagram.tsx`, `CodeStudioPanel.tsx`, etc.).
- `src/renderer/src/shapes/`: Shape definitions (`shapeLibrary.ts`) and SVG shape rendering (`ShapeSvg.tsx`). If modifying generated shape data, regenerate with `npm run generate:shapes`.
- `src/renderer/src/vision/`: MediaPipe webcam hand-tracking engine.

---

## Coding Guidelines

- **Formatting (Prettier)**: Follow [.prettierrc.yaml](.prettierrc.yaml) (`singleQuote: true`, `semi: false`, `printWidth: 100`, `trailingComma: none`). Run `npm run format` before committing.
- **TypeScript & React**:
  - Keep strict TypeScript types — avoid introducing new `any` types in `main`, `shared`, or `renderer`.
  - Keep component files exporting only React components so Vite / React Fast Refresh (`react-refresh/only-export-components`) stays clean; place shared constants and helpers in `src/renderer/src/board/` or `src/shared/`.
  - Preserve adaptive board palette compatibility (`resolveBoardPalette` in `backgroundPresets.ts`) when adding canvas elements so light, dark, and custom board backgrounds remain high contrast.
  - Keep UI responsive across narrow viewports and aligned with the Neo-Brutalist design system in [src/renderer/src/styles.css](src/renderer/src/styles.css).
- **Security & Privacy**:
  - Never commit API keys, credentials, `.env` files, or local SQLite databases (`board_store.db`).
  - Keep BYOK API keys confined to the Electron main process (`safeStorage` + `llmRouter.ts`) — never expose secrets in renderer state or logs.

---

## Verification Checklist Before Opening a PR

Run these checks locally and ensure they pass on the files you changed:

```bash
# 1. Type-check both Node (main/preload) and Web (renderer)
npm run typecheck

# 2. Build production Electron + Vite bundles
npm run build

# 3. Lint modified files (or full repo lint)
npx eslint src/path/to/changed/file.ts

# 4. Verify formatting
npm run format
```

If your changes touch Electron packaging, native modules, or `electron-builder.yml`, also verify packaging:

```bash
npm run build:unpack   # Fast unpacked build check
# or platform-specific:
npm run build:win
```

---

## Pull Request Process

1. Keep PRs focused on a single feature, fix, or improvement.
2. Write clear commit messages (e.g., `feat: add dashed pen rendering`, `fix: clip overflow in AI settings modal`).
3. Include a brief summary of what changed, how you tested it, and screenshots/recordings for visual or UI changes.
4. Make sure no generated artifacts (`dist/`, `out/`, `*.log`, local DBs) are included in your commit.
