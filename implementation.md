# Implementation Plan: AI Virtual Glass Whiteboard (`virtual-glass-board`)

## 1. Goal & System Overview
Build a production-ready **AI-Powered AR Virtual Glass Whiteboard** desktop application using **Electron (`electron-vite`), React, and TypeScript**. The application uses the user's webcam to render an interactive virtual glass board where extending **1 index finger** to cross a calibrated virtual plane writes smooth ink, automatically converts air-written words into clean themed typography, snaps rough shapes into diagrams, and includes a **Push-to-Talk Voice AI Co-Pilot** powered by open-source WebGPU Speech-to-Text and **Ollama (`gemma4:cloud`)** (with encrypted BYOK support for OpenAI, Gemini, Grok, and Claude).

---

## 2. Core Technical Stack & Dependencies
- **Application Framework:** `electron-vite` (Electron + React 18 + TypeScript)
- **Computer Vision (Renderer GPU):** `@mediapipe/tasks-vision` (`HandLandmarker` running at 60 FPS with WebGL `GPU` delegate, tracking up to 2 hands offline via `/public/models/hand_landmarker.task`)
- **Open-Source Speech-to-Text (Renderer WebGPU Worker):** `@huggingface/transformers` (`automatic-speech-recognition` pipeline running `onnx-community/whisper-tiny.en` or `onnx-community/moonshine-base-ONNX` on `webgpu`, with WebAudio `AudioContext` 16kHz PCM capture)
- **Stroke Smoothing & Variable-Width Ink:** Custom `OneEuroFilter` (1€ Filter) + `perfect-freehand`
- **AI & Multimodal Vision Router (Main Process):**
  - **Default Provider:** Local **Ollama** (`http://localhost:11434`) defaulting to `gemma4:cloud` (with support for `gemma4:31b-cloud`, `gemma4:e4b`, and any installed local tags)
  - **BYOK Providers:** OpenAI (`gpt-4o`), Google Gemini (`gemini-2.5-flash`), xAI Grok (`grok-3`), and Anthropic Claude (`claude-sonnet-4-20250514`), with API keys encrypted on disk using Electron's native `safeStorage`
- **Icons & Styling:** `lucide-react` + Vanilla CSS custom properties for instant theme/font switching

---

## 3. Workspace File Structure to Generate

```text
virtual-glass-board/
├── electron.vite.config.ts
├── package.json
├── public/
│   └── models/
│       └── hand_landmarker.task          # MediaPipe float16 hand landmarker binary
└── src/
    ├── main/
    │   ├── index.ts                      # BrowserWindow (Mode A/B), WebGPU flags, permissions, global shortcuts, IPC
    │   └── llmRouter.ts                  # Ollama health checker, safeStorage API key vault, multi-provider AI & Vision OCR router
    ├── preload/
    │   ├── index.ts                      # contextBridge exposing window.glassAPI
    │   └── index.d.ts                    # TypeScript declarations for window.glassAPI
    └── renderer/
        ├── index.html                    # Loads Google Fonts: Caveat, Plus Jakarta Sans, JetBrains Mono
        └── src/
            ├── main.tsx                  # React root mount
            ├── App.tsx                   # Main workspace, 3-layer stack, toolbar, settings modal, state orchestration
            ├── styles.css                # CSS variables for 4 Themes, 3 Fonts, Mode A/B layouts, glassmorphism UI
            ├── types/
            │   └── board.ts              # Shared interfaces for Strokes, TextNodes, ShapeNodes, AI Actions, Settings
            ├── vision/
            │   ├── OneEuroFilter.ts      # Speed-adaptive low-pass filter to eliminate webcam jitter
            │   ├── handEngine.ts         # 1-Finger-to-Board Z-distance estimator, hysteresis state machine, 2-hand PTT gesture
            │   └── shapeSnapper.ts       # Geometric primitive recognizer (rectangles, circles, arrows)
            └── audio/
                ├── sttWorker.ts          # WebGPU @huggingface/transformers speech recognition worker
                └── usePushToTalk.ts      # Hook managing mic 16kHz Float32 recording via 'V' hotkey or Left-Hand Pinch
```

---

## 4. Detailed Component Specifications

### 4.1 Electron Main Process (`src/main/index.ts`)
1. **Hardware & WebGPU Flags:**
   - Append Chromium switches before `app.whenReady()`:
     - `app.commandLine.appendSwitch('enable-unsafe-webgpu')`
     - `app.commandLine.appendSwitch('enable-features', 'Vulkan,UseSkiaRenderer')`
2. **Window Initialization:**
   - Create `BrowserWindow` (`1440x900`, `transparent: true`, `frame: false`, `hasShadow: false`).
   - Auto-approve media permissions via `session.defaultSession.setPermissionRequestHandler` for `'media'`, `'audioCapture'`, and `'videoCapture'`.
3. **Display Mode Switching (`MODE_A` vs `MODE_B`):**
   - **Mode A (Studio AR Lightboard):** `mainWindow.setAlwaysOnTop(false)`, `mainWindow.setIgnoreMouseEvents(false)`. Full-viewport mirrored webcam feed with frosted dark tint underneath glowing neon/chalk ink.
   - **Mode B (Transparent OS Desktop Overlay):** `mainWindow.setAlwaysOnTop(true, 'screen-saver')`. Full-screen background becomes 100% transparent so the user can write over IDEs, PDFs, or browsers; webcam shrinks into a draggable `220x135px` corner Picture-in-Picture (PiP) radar.
   - Register global shortcut `Alt+Space` to toggle OS mouse click-through (`mainWindow.setIgnoreMouseEvents(enabled, { forward: true })`) and notify Renderer via IPC (`board:clickThroughChanged`).

### 4.2 Multi-Provider AI Router & Ollama Checker (`src/main/llmRouter.ts`)
1. **Ollama Connection Checker (`ai:checkOllama`):**
   - Fetch `GET ${ollamaHost}/api/tags` (default `http://localhost:11434`).
   - Return `{ online: boolean, models: string[], error?: string }`.
   - Always prepend `['gemma4:cloud', 'gemma4:31b-cloud', 'gemma4:e4b']` to the discovered local models list so the user can pick `gemma4:cloud` immediately.
2. **Encrypted API Key Storage (`ai:saveKey` & `ai:hasKey`):**
   - Use Electron `safeStorage.encryptString(apiKey)` and persist base64 payloads inside `app.getPath('userData')/encrypted-keys.json`. Never expose raw API keys to the Renderer process.
3. **Dual-Purpose AI Execution (`ai:run`):**
   - **Task 1 — Air-Handwriting Optical Recognition (`isHandwritingOCR = true`):**
     - Accepts a cropped base64 PNG of the user's recent air-written word strokes (white strokes on black background).
     - Sends the image to `gemma4:cloud` (via Ollama `/api/chat` `images: [base64]`) or the selected BYOK vision model.
     - Returns strict JSON: `{ "recognizedText": "string" }`.
   - **Task 2 — Voice Co-Pilot Board Generation (`isHandwritingOCR = false`):**
     - Accepts the transcribed voice instruction from the user's microphone along with the current finger cursor anchor `(cursorX, cursorY)` and existing board context.
     - System prompt instructs the model to output strict JSON:
       ```json
       {
         "notes": [
           { "title": "Optional Heading", "text": "Clean note or bullet content", "x": 400, "y": 300 }
         ],
         "shapes": [
           { "shape": "rect", "x": 400, "y": 420, "w": 180, "h": 90, "label": "Node Label" },
           { "shape": "arrow", "x": 580, "y": 465, "w": 100, "h": 0, "label": "flow" }
         ]
       }
       ```

### 4.3 1-Finger Virtual Glass Distance Engine & 2-Hand Tracking (`src/renderer/src/vision/handEngine.ts`)
1. **Two-Hand Role Separation:**
   - Configure MediaPipe `HandLandmarker` with `numHands: 2`, `runningMode: 'VIDEO'`, `delegate: 'GPU'`.
   - **Primary Hand (Writing Hand):** Controls cursor position, 1-finger virtual glass depth detection, and palm erasing.
   - **Secondary Hand (Assistant Hand):** Detects a **Thumb-Tip (`4`) to Index-Tip (`8`) Pinch** (`Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y) < 0.048`). Holding this pinch triggers **Push-to-Talk (PTT)** voice recording hands-free.
2. **1-Finger-to-Board Distance Calculation (`VirtualBoardDepthEstimator`):**
   - **Posture Gate:** Verify that **only 1 finger (Index `8`)** is extended (`lm[8].y < lm[6].y`) while Middle (`12`), Ring (`16`), and Pinky (`20`) fingers are curled (`lm[12].y > lm[10].y`, `lm[16].y > lm[14].y`).
   - **5-Finger Open Palm Erase Gate:** If Index, Middle, Ring, and Pinky are all extended (`isErasing = true`), sweep a 60px eraser radius across `strokes`, `textNodes`, and `shapeNodes`.
   - **3D Reach Metric Formula:**
     - Calculate the 3D Euclidean length of the rigid palm segment between Wrist (`0`) and Index MCP Knuckle (`5`) to measure absolute hand-to-camera scale invariant of 2D rotation:
       `palmScale3D = Math.hypot(lm[5].x - lm[0].x, lm[5].y - lm[0].y, lm[5].z - lm[0].z)`
     - Calculate forward fingertip extension relative to the knuckle:
       `tipForward = (lm[5].z - lm[8].z) * 0.40`
     - Combine into `currentReach = palmScale3D + tipForward`.
     - Compute signed distance in millimeters to the calibrated glass plane:
       `distanceMm = Math.round((calibratedPlaneMetric - currentReach) * 680)`
   - **Hysteresis Thresholds:**
     - Enter `isPenDown = true` when `distanceMm <= 0` (finger touches/crosses virtual glass).
     - Stay `isPenDown = true` until `distanceMm > 16` (user pulls finger back at least 16mm from glass). This eliminates stroke breaks while writing across the screen.
   - **Calibration (`C` Hotkey or Toolbar Button):**
     - Pressing `C` while holding 1 index finger at comfortable writing distance sets `calibratedPlaneMetric = currentReach`.
3. **1-Euro Filter (`OneEuroFilter.ts`) & Depth Sonar Ring HUD:**
   - Filter mirrored viewport coordinates `rawX = (1 - lm[8].x) * width` and `rawY = lm[8].y * height` using `OneEuroFilter(minCutoff = 1.1, beta = 0.009, dCutoff = 1.0)`.
   - Draw a dynamic **Depth Sonar Ring** on the 60 FPS HUD canvas centered at `(x, y)`:
     - Outer sonar ring radius shrinks smoothly from `36px` (far hover) down to `6px` (`distanceMm <= 0`), changing color from theme primary ink (hover) to theme accent color with a solid glowing center when `isPenDown === true`.

### 4.4 Three-Mode Ink Switcher & Auto-Word Detection (`src/renderer/src/App.tsx`)
Provide a prominent toolbar segmented control and keyboard hotkeys (`1`, `2`, `3`) for three ink behaviors:
1. **`[1] Auto-Text: ON` (Air-Handwriting to Clean Typography):**
   - As the user writes strokes in mid-air, each completed stroke is added to `pendingWordStrokesRef` and rendered immediately on the HUD canvas so visual feedback is instantaneous.
   - Lifting the finger (`isPenDown: true -> false`) starts a `900ms` debounce timer. Touching the board again before `900ms` (e.g., writing the next letter or dotting an "i") cancels the timer and appends to the same word group.
   - When the `900ms` timer fires:
     1. Compute the padded bounding box `(minX, minY, maxX, maxY)` of all strokes in `pendingWordStrokesRef`.
     2. Render those strokes in crisp white ink (`lineWidth = 5`) on a solid black offscreen `<canvas>`.
     3. Send the base64 PNG to `window.glassAPI.runAI(..., base64Crop)` (using `gemma4:cloud` or selected provider).
     4. Replace the raw finger strokes at `(minX, minY)` with a clean `TextNode` rendered in the user's selected **Font** and **Theme**.
2. **`[2] Freehand Sketch`:**
   - Commits smoothed `perfect-freehand` variable-width vector polygons directly to the board without OCR conversion.
3. **`[3] Auto-Shape Diagram` (`shapeSnapper.ts`):**
   - Analyzes each completed stroke:
     - **Arrow / Line:** If `endToStartDistance / totalPathLength > 0.88`, convert into a straight line or directional arrow connector.
     - **Closed Loop (Rectangle vs. Circle):** If start and end points are close, inspect the bounding box aspect ratio and corner sharpness to snap into a clean rounded rectangle or circle node.

### 4.5 Push-to-Talk Voice Assistant (`usePushToTalk.ts` & `sttWorker.ts`)
1. **Activation Triggers:**
   - Active while holding **`V` on the keyboard** OR holding the **Left-Hand Thumb-Index Pinch gesture** (`leftHandPTT === true`).
   - Show a pulsing red **"Listening (PTT)..."** badge in the top bar while recording.
2. **Audio Capture & WebGPU Transcription:**
   - Capture microphone audio at `16000 Hz` mono `Float32Array` using Web Audio API.
   - On release of `V` or Left-Hand Pinch, post the `Float32Array` buffer to `sttWorker.ts`.
   - `sttWorker.ts` runs `@huggingface/transformers` `pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', { device: 'webgpu' })` (with automatic fallback to `'wasm'` if WebGPU is unavailable) and emits `{ type: 'TRANSCRIPT', text }`.
   - Pass `text` and current cursor `(x, y)` to `window.glassAPI.runAI(...)` to draw the requested notes and diagram nodes onto the board.

### 4.6 Themes & Typography System (`src/renderer/src/styles.css`)
Load Google Fonts (`Caveat`, `Plus Jakarta Sans`, `JetBrains Mono`) in `index.html` and support live switching of:
- **4 Built-in Themes:**
  1. `neon` (**Neon Lightboard**): Backdrop `rgba(9, 13, 22, 0.70)` + `blur(6px)`, Primary Ink `#00F5D4`, Accent `#FF2A85`
  2. `chalk` (**Warm Chalkboard**): Backdrop `rgba(22, 32, 26, 0.84)`, Primary Ink `#F4F1DE`, Accent `#F2CC8F`
  3. `blueprint` (**Architectural Blueprint**): Backdrop `rgba(13, 35, 64, 0.80)` with 24px CSS radial dot grid, Primary Ink `#FFFFFF`, Accent `#38BDF8`
  4. `overlay` (**Desktop Ink — Mode B**): Backdrop `transparent`, Primary Ink `#00E5FF` with high-contrast dark drop shadow, Accent `#FFD60A`
- **3 Built-in Fonts:**
  1. `"Caveat", cursive` (Organic handwritten notes)
  2. `"Plus Jakarta Sans", sans-serif` (Clean executive typography)
  3. `"JetBrains Mono", monospace` (Technical/code diagram labels)

---

## 5. Step-by-Step Execution Checklist

- [ ] **Phase 1: Project Scaffolding & Model Assets**
  - [ ] Initialize `electron-vite` React TypeScript project in current workspace.
  - [ ] Install `@mediapipe/tasks-vision`, `@huggingface/transformers`, `perfect-freehand`, and `lucide-react`.
  - [ ] Download `hand_landmarker.task` from Google MediaPipe storage into `public/models/hand_landmarker.task`.
  - [ ] Include Google Fonts (`Caveat`, `Plus Jakarta Sans`, `JetBrains Mono`) in `src/renderer/index.html`.
- [ ] **Phase 2: Electron Main, Preload & Multi-Provider AI Router**
  - [ ] Implement `src/main/llmRouter.ts` with `checkOllamaStatus` (`localhost:11434`), `safeStorage` API key encryption, and unified `runAIRequest` supporting `ollama` (`gemma4:cloud`), `openai`, `gemini`, `grok`, and `claude`.
  - [ ] Implement `src/main/index.ts` with transparent frameless window, media permission handler, `MODE_A`/`MODE_B` window state switcher, and `Alt+Space` click-through toggle.
  - [ ] Implement `src/preload/index.ts` and `src/preload/index.d.ts` exposing `window.glassAPI`.
- [ ] **Phase 3: Computer Vision, 1-Euro Filter & 1-Finger Distance Engine**
  - [ ] Implement `src/renderer/src/vision/OneEuroFilter.ts`.
  - [ ] Implement `src/renderer/src/vision/handEngine.ts` with 3D palm scale + fingertip extension depth calculation, hysteresis (`0mm` enter / `16mm` exit), `C` plane calibration, 5-finger palm erase, and secondary-hand PTT pinch detection.
  - [ ] Implement `src/renderer/src/vision/shapeSnapper.ts` to classify closed loops (rect/circle) and straight lines/arrows.
- [ ] **Phase 4: Open-Source WebGPU Speech-to-Text Worker**
  - [ ] Implement `src/renderer/src/audio/sttWorker.ts` using `@huggingface/transformers` ASR pipeline with WebGPU acceleration and WASM fallback.
  - [ ] Implement `src/renderer/src/audio/usePushToTalk.ts` to record 16kHz mono PCM audio when `V` key or Left-Hand Pinch is held.
- [ ] **Phase 5: Lightboard Renderer UI, Auto-Text Pipeline & Settings Modal**
  - [ ] Build the 3-layer stack in `src/renderer/src/App.tsx`: `VideoFeed` (full-screen in Mode A, corner PiP in Mode B), `CommittedCanvas` (strokes, snapped shapes, typed text blocks), and `HudCanvas` (60 FPS Depth Sonar Ring, active stroke preview, pending word strokes).
  - [ ] Wire the `900ms` pause timer in `AUTO_TEXT` mode to crop `pendingWordStrokes`, send base64 PNG to `gemma4:cloud`, and morph into a themed `TextNode`.
  - [ ] Build the floating glass Toolbar (Mode A/B switch, `[1] Auto-Text`, `[2] Freehand`, `[3] Auto-Shape`, Theme selector, Font selector, Calibrate button, Clear/Export PNG button, Settings toggle).
  - [ ] Build the AI Settings Modal with live Ollama connection status indicator (`Connected 11434` / `Offline`), model dropdown (`gemma4:cloud`, `gemma4:31b-cloud`, `gemma4:e4b`), and encrypted API key inputs for OpenAI, Gemini, Grok, and Claude.

---

## 6. Verification & Acceptance Criteria
1. **Build & Typecheck:** Run `npm run typecheck` and `npm run build` with zero TypeScript or bundler errors.
2. **Ollama Checker Verification:** Open AI Settings modal -> click **Re-check Ollama** -> verify `http://localhost:11434/api/tags` populates the dropdown with `gemma4:cloud` selected by default.
3. **1-Finger Depth & Calibration Verification:** Extend 1 index finger -> press `C` -> verify the Depth Sonar Ring locks onto the fingertip (`isPenDown = true`) and trails smooth ink; pull finger back ~2cm -> verify pen lifts cleanly into hover mode without stray tails.
4. **3-Mode Ink Verification:**
   - In `[1] Auto-Text: ON`, write a word in mid-air and pause 900ms -> verify raw strokes morph into the selected font (`Caveat`, `Plus Jakarta Sans`, or `JetBrains Mono`).
   - In `[2] Freehand Sketch`, verify strokes remain as smooth freehand curves.
   - In `[3] Auto-Shape Diagram`, draw a rough box and an arrow -> verify they snap into crisp geometric primitives.
5. **Mode A / Mode B & PTT Verification:**
   - Toggle **Mode B (OS Overlay)** -> verify background becomes transparent, window stays on top of desktop apps, and camera docks into the bottom-right PiP corner.
   - Hold `V` (or pinch Left Thumb + Index) and speak a command -> verify WebGPU STT transcribes the audio and `gemma4:cloud` places structured notes/diagrams at the finger cursor position.