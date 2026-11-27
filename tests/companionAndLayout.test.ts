import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { BoardState } from '../src/renderer/src/types/board.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const sharedDir = join(repoRoot, 'src', 'shared')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      const target = join(sharedDir, `${specifier.slice('@shared/'.length)}.ts`)
      return nextResolve(pathToFileURL(target).href, context)
    }
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier) &&
      context.parentURL?.startsWith('file://')
    ) {
      const parentDir = dirname(fileURLToPath(context.parentURL))
      const tsCandidate = resolve(parentDir, `${specifier}.ts`)
      if (existsSync(tsCandidate)) {
        return nextResolve(pathToFileURL(tsCandidate).href, context)
      }
      const tsxCandidate = resolve(parentDir, `${specifier}.tsx`)
      if (existsSync(tsxCandidate)) {
        return nextResolve(pathToFileURL(tsxCandidate).href, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return {
        format: 'json',
        shortCircuit: true,
        source: readFileSync(fileURLToPath(url), 'utf8')
      }
    }
    return nextLoad(url, context)
  }
})

const { applyAgentMutationsToBoard, buildAgentBoardSnapshot } = await import(
  '../src/renderer/src/board/agentExecutor.ts'
)
const { startCompanionServer, stopCompanionServer } = await import(
  '../src/main/companionServer.ts'
)

function makeEmptyBoard(): BoardState {
  return {
    strokes: [],
    textNodes: [],
    equationNodes: [],
    shapeNodes: [],
    diagramNodes: [],
    vectorArtNodes: [],
    vectorDiagramMeta: {},
    codeNodes: [],
    videoNodes: [],
    imageNodes: [],
    scene3dNodes: [],
    graphNodes: []
  }
}

const defaultExecOpts = {
  viewportCenter: { x: 500, y: 400 },
  view: { zoom: 1, panX: 0, panY: 0 },
  screenSafe: { left: 84, top: 68, right: 1200, bottom: 800 },
  fontFamily: 'jakarta' as const
}

test('buildAgentBoardSnapshot exposes SpatialScenes, native diagrams, connectors, and boardBounds', () => {
  const board = makeEmptyBoard()
  const outcome = applyAgentMutationsToBoard(
    board,
    [
      {
        type: 'add_note',
        id: 'note-1',
        title: '1. Overview',
        content: 'Intro note',
        x: 60,
        y: 60,
        w: 320,
        h: 180
      },
      {
        type: 'add_spatial_scene',
        id: 'scene-anatomy',
        title: '1.2 Anatomy',
        x: 440,
        y: 60,
        width: 520,
        height: 360,
        scene: {
          title: '1.2 Anatomy',
          elements: [
            { type: 'shape', id: 'box-a', kind: 'rounded_rect', x: 100, y: 150, w: 300, h: 250, label: 'Node A' },
            { type: 'text', id: 'txt-a', x: 500, y: 80, text: 'Graph Anatomy', align: 'center' }
          ]
        }
      },
      {
        type: 'add_reactflow_diagram',
        id: 'diag-taxonomy',
        title: '2.1 Taxonomy',
        diagramType: 'flowchart',
        direction: 'LR',
        x: 60,
        y: 480,
        nodes: [
          { id: 'n1', label: 'Graphs' },
          { id: 'n2', label: 'Trees' }
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', label: 'acyclic' }]
      },
      {
        type: 'add_code_card',
        id: 'code-1',
        title: 'bfs.py',
        language: 'python',
        code: 'x = [1, 2]\ny = [3, 4]',
        x: 1020,
        y: 60
      },
      {
        type: 'add_graph_card',
        id: 'graph-1',
        title: 'Plot',
        chartType: 'bar',
        x: 1620,
        y: 60
      },
      {
        type: 'add_connector',
        sourceId: 'code-1',
        targetId: 'graph-1',
        sourcePort: 'right',
        targetPort: 'left'
      }
    ],
    { ...defaultExecOpts, honorExplicitCoords: true }
  )

  const snap = buildAgentBoardSnapshot({
    board: outcome.nextBoard,
    boardId: 'sec-1',
    selectedIds: [],
    viewportCenter: { x: 500, y: 400 }
  })

  const sceneEntry = snap.diagrams.find((d) => d.id === 'scene-anatomy')
  const diagEntry = snap.diagrams.find((d) => d.id === 'diag-taxonomy')
  assert.ok(sceneEntry, 'Expected SpatialScene to appear in snapshot.diagrams')
  assert.equal(sceneEntry!.title, '1.2 Anatomy')
  assert.equal(sceneEntry!.diagramType, 'spatial_scene')
  assert.ok(sceneEntry!.w > 100 && sceneEntry!.h > 100)

  assert.ok(diagEntry, 'Expected compiled ReactFlow diagram to appear in snapshot.diagrams')
  assert.equal(diagEntry!.title, '2.1 Taxonomy')
  assert.equal(diagEntry!.diagramType, 'native_diagram')

  assert.equal(snap.vectorGroups.length, 2)
  assert.equal(snap.connectors.length, 1)
  assert.equal(snap.connectors[0].sourceId, 'code-1')
  assert.equal(snap.connectors[0].targetId, 'graph-1')
  assert.ok(snap.boardBounds && snap.boardBounds.w > 1000 && snap.boardBounds.h > 400)
})

test('applyAgentMutationsToBoard honors explicit x/y on notes, equations, and code cards when honorExplicitCoords is true', () => {
  const board = makeEmptyBoard()
  const outcome = applyAgentMutationsToBoard(
    board,
    [
      { type: 'add_note', id: 'n-a', title: '4.2a', content: 'A', x: 0, y: 200, w: 300, h: 160 },
      { type: 'add_note', id: 'n-b', title: '4.2b', content: 'B', x: 320, y: 200, w: 300, h: 160 },
      { type: 'add_equation', id: 'eq-1', latex: 'O(V+E)', x: 640, y: 200, w: 280, h: 96 },
      { type: 'add_code_card', id: 'c-1', title: '1.py', language: 'python', code: 'a=1', x: 0, y: 420 },
      { type: 'add_code_card', id: 'c-2', title: '2.py', language: 'python', code: 'b=2', x: 560, y: 420 },
      { type: 'add_code_card', id: 'c-3', title: '3.py', language: 'python', code: 'c=3', x: 1120, y: 420 }
    ],
    { ...defaultExecOpts, honorExplicitCoords: true }
  )

  const na = outcome.nextBoard.textNodes.find((n) => n.id === 'n-a')!
  const nb = outcome.nextBoard.textNodes.find((n) => n.id === 'n-b')!
  const eq = outcome.nextBoard.equationNodes.find((e) => e.id === 'eq-1')!
  const c1 = outcome.nextBoard.codeNodes!.find((c) => c.id === 'c-1')!
  const c2 = outcome.nextBoard.codeNodes!.find((c) => c.id === 'c-2')!
  const c3 = outcome.nextBoard.codeNodes!.find((c) => c.id === 'c-3')!

  assert.equal(na.x, 0)
  assert.equal(na.y, 200)
  assert.equal(nb.x, 320)
  assert.equal(nb.y, 200)
  assert.equal(eq.x, 640)
  assert.equal(eq.y, 200)
  assert.equal(c1.x, 0)
  assert.equal(c2.x, 560)
  assert.equal(c3.x, 1120)
  assert.ok(c1.x < c2.x && c2.x < c3.x)
})

test('unpositioned connected pipeline batch lays out stages strictly left-to-right', () => {
  const board = makeEmptyBoard()
  const outcome = applyAgentMutationsToBoard(
    board,
    [
      { type: 'add_code_card', id: 's1', title: '1.py', language: 'python', code: 'x=[1,2]\ny=[3,4]' },
      { type: 'add_code_card', id: 's2', title: '2.py', language: 'python', code: 'def transform(d): return d' },
      { type: 'add_connector', sourceId: 's1', targetId: 's2', sourcePort: 'right', targetPort: 'left' },
      { type: 'add_graph_card', id: 'g1', title: 'Out', chartType: 'line' },
      { type: 'add_connector', sourceId: 's2', targetId: 'g1', sourcePort: 'right', targetPort: 'left' }
    ],
    defaultExecOpts
  )

  const s1 = outcome.nextBoard.codeNodes!.find((c) => c.id === 's1')!
  const s2 = outcome.nextBoard.codeNodes!.find((c) => c.id === 's2')!
  const g1 = outcome.nextBoard.graphNodes!.find((g) => g.id === 'g1')!
  assert.equal(s1.y, s2.y)
  assert.equal(s2.y, g1.y)
  assert.ok(s1.x + s1.w <= s2.x && s2.x + s2.w <= g1.x, 'Pipeline stages should flow strictly left-to-right')
})

test('move_elements moves SpatialScene groups & cards, re-routes bound connectors, and delete_elements cleans groups', () => {
  const board = makeEmptyBoard()
  const created = applyAgentMutationsToBoard(
    board,
    [
      {
        type: 'add_spatial_scene',
        id: 'scene-1',
        title: 'Box Scene',
        x: 100,
        y: 100,
        width: 400,
        height: 300,
        scene: {
          title: 'Box Scene',
          elements: [
            { type: 'shape', id: 'rect1', kind: 'rect', x: 100, y: 100, w: 400, h: 400, label: 'A' },
            { type: 'text', id: 't1', x: 500, y: 700, text: 'Caption', align: 'center' }
          ]
        }
      },
      { type: 'add_code_card', id: 'c1', title: 'c1.py', language: 'python', code: 'a=1', x: 100, y: 500 },
      { type: 'add_code_card', id: 'c2', title: 'c2.py', language: 'python', code: 'b=2', x: 700, y: 500 },
      { type: 'add_connector', sourceId: 'c1', targetId: 'c2', sourcePort: 'right', targetPort: 'left' }
    ],
    { ...defaultExecOpts, honorExplicitCoords: true }
  )

  const moved = applyAgentMutationsToBoard(
    created.nextBoard,
    [
      {
        type: 'move_elements',
        moves: [
          { id: 'scene-1', x: 900, y: 80 },
          { id: 'c2', x: 1400, y: 500 }
        ]
      }
    ],
    { ...defaultExecOpts, honorExplicitCoords: true }
  )

  const snapAfterMove = buildAgentBoardSnapshot({
    board: moved.nextBoard,
    boardId: 'sec-1',
    selectedIds: [],
    viewportCenter: { x: 500, y: 400 }
  })
  const movedScene = snapAfterMove.vectorGroups.find((g) => g.id === 'scene-1')!
  assert.equal(movedScene.x, 900)
  assert.equal(movedScene.y, 80)

  const c2After = moved.nextBoard.codeNodes!.find((c) => c.id === 'c2')!
  assert.equal(c2After.x, 1400)
  const connAfter = moved.nextBoard.shapeNodes.find((s) => s.startBinding?.shapeId === 'c1')!
  const connEndX = connAfter.points![connAfter.points!.length - 1][0]
  assert.equal(connEndX, 1400, 'Bound connector endpoint should re-route to moved target left port')

  const deleted = applyAgentMutationsToBoard(
    moved.nextBoard,
    [{ type: 'delete_elements', elementIds: ['scene-1'] }],
    defaultExecOpts
  )
  assert.equal(deleted.nextBoard.shapeNodes.filter((s) => s.vectorGroupId === 'scene-1').length, 0)
  assert.equal(deleted.nextBoard.textNodes.filter((t) => t.vectorGroupId === 'scene-1').length, 0)
  assert.equal(deleted.nextBoard.vectorDiagramMeta?.['scene-1'], undefined)
})

test('companionServer serves /api/board-image, vexelboard_capture_board, vexelboard_move_elements, and explicit x/y on add_*', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'vexel-comp-test-'))
  const bridgeFilePath = join(tempRoot, 'bridge.json')
  const captureDir = join(tempRoot, 'captures')
  const capturedMutations: any[] = []
  const fakePngBase64 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64').toString('base64')

  try {
    const status = await startCompanionServer({
      bridgeFilePath,
      captureDir,
      onMutations: (muts) => {
        capturedMutations.push(...muts)
        return true
      },
      requestLiveBoardCapture: async ({ mode }) => ({
        ok: true,
        mode,
        boardId: 'sec-test',
        boardBounds: { x: 0, y: 0, width: 1200, height: 800 },
        capturedBounds: { x: 0, y: 0, width: 1200, height: 800 },
        elementCount: 4,
        width: 1280,
        height: 800,
        base64Png: fakePngBase64
      })
    })

    const imgRes = await fetch(`${status.baseUrl}/api/board-image?mode=board`)
    const imgJson: any = await imgRes.json()
    assert.equal(imgRes.status, 200)
    assert.equal(imgJson.ok, true)
    assert.equal(imgJson.mode, 'board')
    assert.ok(imgJson.filePath && existsSync(imgJson.filePath), 'Expected PNG written to captureDir')
    assert.equal(imgJson.base64Png, undefined, 'REST /api/board-image omits base64Png unless includeBase64=1')

    const callMcp = async (id: number, name: string, args: Record<string, unknown>) => {
      const r = await fetch(status.mcpUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args }
        })
      })
      return (await r.json()) as any
    }

    const mcpCap = await callMcp(1, 'vexelboard_capture_board', { mode: 'viewport' })
    assert.equal(mcpCap.result.isError, false)
    assert.equal(mcpCap.result.content.length, 2)
    assert.equal(mcpCap.result.content[1].type, 'image')
    assert.equal(mcpCap.result.content[1].mimeType, 'image/png')

    const mcpNote = await callMcp(2, 'vexelboard_add_note', {
      id: 'note-mcp',
      title: 'Step 1',
      content: 'Hello',
      x: 120,
      y: 240,
      w: 360,
      h: 200
    })
    assert.equal(mcpNote.result.isError, false)

    const mcpEq = await callMcp(3, 'vexelboard_add_equation', {
      id: 'eq-mcp',
      latex: 'E = mc^2',
      x: 520,
      y: 240
    })
    assert.equal(mcpEq.result.isError, false)

    const mcpMove = await callMcp(4, 'vexelboard_move_elements', {
      moves: [{ id: 'note-mcp', x: 180, y: 260 }]
    })
    assert.equal(mcpMove.result.isError, false)

    assert.equal(capturedMutations.length, 3)
    assert.equal(capturedMutations[0].type, 'add_note')
    assert.equal(capturedMutations[0].id, 'note-mcp')
    assert.equal(capturedMutations[0].x, 120)
    assert.equal(capturedMutations[0].y, 240)
    assert.equal(capturedMutations[1].type, 'add_equation')
    assert.equal(capturedMutations[1].id, 'eq-mcp')
    assert.equal(capturedMutations[1].x, 520)
    assert.equal(capturedMutations[2].type, 'move_elements')
    assert.equal(capturedMutations[2].moves[0].x, 180)
  } finally {
    stopCompanionServer()
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
