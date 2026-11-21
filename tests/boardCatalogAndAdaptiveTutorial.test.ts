import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  BOARD_COLOR_PALETTES,
  BOARD_FONT_CATALOG,
  BOARD_SHAPE_CATALOG,
  FIRST_PRINCIPLES_PRIMITIVES,
  formatDiscoveredAssetsForPrompt,
  inferPedagogicalApproach,
  searchBoardAssets
} from '../src/shared/boardCatalog.ts'
import { SpatialSceneSchema, normalizeSpatialSceneInput } from '../src/shared/beautifySchema.ts'
import { compileSpatialScene } from '../src/renderer/src/board/spatialSceneCompiler.ts'
import { runAgentLoop, type AgentToolDefinition } from '../src/main/agent/agentHarness.ts'
import type { AgentRunRequest } from '../src/shared/agentSchema.ts'

function makeRequest(prompt: string, mode: AgentRunRequest['mode'] = 'general'): AgentRunRequest {
  return {
    runId: 'run-first-principles-test',
    prompt,
    mode,
    provider: 'openai',
    model: 'gpt-4o',
    boardSnapshot: {
      boardId: 'sec-1',
      activeLayerId: 'layer-cards',
      knowledgeSourceCount: 0,
      layers: [
        {
          id: 'layer-overlay-ink',
          name: 'Annotations (Top)',
          kind: 'ink',
          visible: true,
          locked: false,
          opacity: 1,
          order: 0
        },
        {
          id: 'layer-cards',
          name: 'Cards & Widgets',
          kind: 'elements',
          visible: true,
          locked: false,
          opacity: 1,
          order: 1
        }
      ],
      notes: [],
      equations: [],
      codeCards: [],
      diagrams: [],
      media: [],
      strokeCount: 0,
      textCount: 0,
      shapeCount: 0
    }
  }
}

test('first-principles board catalog integrity: unique IDs, primitives, fonts, and semantic palettes', () => {
  const seenIds = new Set<string>()
  for (const shape of BOARD_SHAPE_CATALOG) {
    assert.ok(shape.id.length > 0)
    assert.equal(seenIds.has(shape.id), false, `Duplicate shape id: ${shape.id}`)
    seenIds.add(shape.id)
    assert.ok(shape.defaultSize[0] > 0 && shape.defaultSize[1] > 0)
    assert.ok(shape.tags.length > 0)
  }

  for (const requiredId of ['hexagon', 'pentagon', 'star-5', 'cross', 'donut', 'svg-path', 'anim-line-wave', 'anim-line-loop']) {
    assert.ok(seenIds.has(requiredId), `Missing expected versatile shape: ${requiredId}`)
  }

  const primIds = FIRST_PRINCIPLES_PRIMITIVES.map((p) => p.id)
  assert.ok(primIds.includes('spatial_svg_path'))
  assert.ok(primIds.includes('spatial_shape'))
  assert.ok(primIds.includes('spatial_curve_connector'))
  assert.ok(primIds.includes('spatial_cell_strip'))
  assert.ok(primIds.includes('symbolic_equation'))

  assert.deepEqual(
    BOARD_FONT_CATALOG.map((f) => f.id).sort(),
    ['caveat', 'grotesk', 'jakarta', 'mono', 'serif']
  )
  assert.ok(BOARD_COLOR_PALETTES.some((p) => p.id === 'semantic-organic-bio'))
  assert.ok(BOARD_COLOR_PALETTES.some((p) => p.id === 'semantic-energy-reaction'))
  assert.ok(BOARD_COLOR_PALETTES.some((p) => p.id === 'semantic-quantum-wave'))
})

test('inferPedagogicalApproach synthesizes dynamically without hardcoded domain rejections across any subject', () => {
  const bio = inferPedagogicalApproach('Cellular respiration inside mitochondria organelle membrane and enzyme reaction pathway')
  assert.equal(bio.id, 'first_principles_synthesis')
  assert.equal(bio.recommendedPaletteId, 'semantic-organic-bio')
  assert.ok(bio.primitives.some((p) => p.id === 'spatial_svg_path'))

  const chem = inferPedagogicalApproach('SN2 chemical reaction activation energy enthalpy catalyst hexagon benzene ring')
  assert.equal(chem.id, 'first_principles_synthesis')
  assert.equal(chem.recommendedPaletteId, 'semantic-energy-reaction')

  const atom = inferPedagogicalApproach('Bohr atomic physics orbital transitions electron jump and photon emission wave')
  assert.equal(atom.id, 'first_principles_synthesis')
  assert.equal(atom.recommendedPaletteId, 'semantic-quantum-wave')
  assert.equal(atom.recommendedFont, 'serif')

  const arch = inferPedagogicalApproach('Transformer Mixture of Experts neural architecture routing pipeline')
  assert.equal(arch.id, 'first_principles_synthesis')
  assert.equal(arch.recommendedPaletteId, 'semantic-systems')
})

test('searchBoardAssets and formatDiscoveredAssetsForPrompt discover primitives and shapes across science domains', () => {
  const bioSearch = searchBoardAssets({ query: 'chloroplast organelle membrane photosynthesis biology', assetType: 'all', limit: 10 })
  assert.ok(bioSearch.primitives.length > 0)
  assert.ok(bioSearch.shapes.some((s) => s.id === 'svg-path'))
  assert.equal(bioSearch.colorPalettes[0].id, 'semantic-organic-bio')

  const primOnly = searchBoardAssets({ query: 'activation energy curve wave', assetType: 'primitives', limit: 4 })
  assert.equal(primOnly.primitives.length, 4)
  assert.equal(primOnly.primitives[0].id, 'spatial_curve_connector')

  const mlSearch = searchBoardAssets({ query: 'transformer neural network', assetType: 'shapes', limit: 8 })
  assert.ok(mlSearch.shapes.some((s) => s.id === 'ml-neural-net'))

  const promptText = formatDiscoveredAssetsForPrompt('Bohr hydrogen atom electron orbital photon wave', 10)
  assert.ok(promptText.includes('[DISCOVERED FIRST-PRINCIPLES BOARD PRIMITIVES & ASSETS]'))
  assert.ok(promptText.includes('Composable Primitives:'))
  assert.ok(promptText.includes('Matching Shape IDs:'))
})

test('Atomic Physics first-principles SpatialScene: concentric radial orbitals, tiny electrons, and curved animated photon wave', () => {
  const rawAtomScene = {
    title: 'Bohr Atom n=3 to n=2 Photon Emission',
    shapes: [
      { id: 'orbit_2', kind: 'circle', cx: 500, cy: 500, r: 220, fill: 'transparent', stroke: '#38BDF8', strokeStyle: 'dashed' },
      { id: 'orbit_1', kind: 'circle', cx: 500, cy: 500, r: 120, fill: 'transparent', stroke: '#0284C7', strokeStyle: 'dashed' },
      { id: 'nucleus', kind: 'sphere3d', cx: 500, cy: 500, r: 36, fill: '#EF4444', stroke: '#991B1B', label: '+Ze' },
      { id: 'electron', kind: 'circle', cx: 720, cy: 500, r: 12, fill: '#2563EB', stroke: '#1E40AF', flowStage: 0, animated: true }
    ],
    curves: [
      {
        id: 'photon_wave',
        points: [[560, 440], [640, 380], [720, 440], [800, 380], [880, 440]],
        arrowEnd: true,
        stroke: '#F59E0B',
        animated: true,
        pulseColor: '#F59E0B',
        flowStage: 1
      }
    ],
    texts: [
      { id: 'eq_lbl', x: 500, y: 120, text: 'E = hf = E3 - E2', fontSize: 18, bold: true, align: 'center' }
    ]
  }

  const normalized = normalizeSpatialSceneInput(rawAtomScene)
  const parsed = SpatialSceneSchema.parse(normalized)
  const compiled = compileSpatialScene(parsed, { x: 0, y: 0, width: 500, height: 500 }, 'serif')

  const circles = compiled.shapes.filter((s) => s.shape === 'circle')
  assert.equal(circles.length, 3, 'Expected n=2 orbital, n=1 orbital, and tiny electron')

  // Verify concentric alignment was NOT distorted (both orbitals share center (250, 250) in 500x500 anchor)
  const orbit2 = circles[0]
  const orbit1 = circles[1]
  assert.equal(Math.round(orbit2.x + orbit2.w / 2), 250)
  assert.equal(Math.round(orbit1.x + orbit1.w / 2), 250)
  assert.equal(orbit2.fillColor, 'transparent')
  assert.equal(orbit2.strokeStyle, 'dashed')

  // Verify tiny electron preserved radius 12 -> diameter 24/1000 * 500 = 12px (< old 24px clamp!)
  const electron = circles[2]
  assert.equal(electron.w, 12)
  assert.equal(electron.h, 12)

  // Verify nucleus sphere3d preserved
  const nucleus = compiled.shapes.find((s) => s.shape === 'sphere3d')
  assert.ok(nucleus)
  assert.equal(nucleus!.label, '+Ze')

  // Verify 5-pt curved photon wave compiled to smooth Catmull-Rom spline polyline + synchronized wave stages
  const wave = compiled.shapes.find((s) => s.shape === 'polyline')
  assert.ok(wave && wave.points && wave.points.length > 15, 'Expected smooth spline samples > 15 points')
  assert.equal(wave!.routing, 'curved')
  assert.equal(wave!.animated, true)
  assert.equal(wave!.flowStage, 1)
  assert.equal(wave!.flowTotalStages, 2)
  assert.equal(electron.flowTotalStages, 2)
})

test('Chemistry & Biology first-principles SpatialScene: hexagons, rotation, translucent svg_path organelles, and gapped codon cell_strip', () => {
  const bioChemScene = {
    title: 'Membrane Organelle, Benzene Ring & mRNA Translation',
    elements: [
      {
        type: 'svg_path',
        id: 'chloroplast',
        d: 'M 100 300 C 180 120 460 120 540 300 C 460 480 180 480 100 300 Z',
        fill: '#DCFCE7',
        fillOpacity: 0.3,
        stroke: '#15803D',
        strokeWidth: 3
      },
      {
        type: 'shape',
        id: 'benzene',
        kind: 'hexagon',
        x: 640,
        y: 160,
        w: 180,
        h: 180,
        rotation: 30,
        fill: '#FEF3C7',
        fillOpacity: 0.75,
        stroke: '#D97706',
        label: 'C6H6'
      },
      {
        type: 'cell_strip',
        id: 'mrna_chain',
        orientation: 'horizontal',
        x: 120,
        y: 650,
        w: 760,
        h: 100,
        cells: ['AUG', 'GCU', 'UUC', 'UAG'],
        cellGap: 32,
        connectorArrows: 'forward',
        cellFill: '#E0F2FE'
      }
    ]
  }

  const normalized = normalizeSpatialSceneInput(bioChemScene)
  const parsed = SpatialSceneSchema.parse(normalized)
  const compiled = compileSpatialScene(parsed, { x: 100, y: 100, width: 600, height: 480 }, 'jakarta')

  const svgNode = compiled.shapes.find((s) => s.shape === 'svg-path')
  assert.ok(svgNode, 'Expected custom svg-path organelle node')
  assert.equal(svgNode!.fillOpacity, 0.3)
  assert.equal(svgNode!.color, '#15803D')
  assert.ok(svgNode!.svgPath && svgNode!.svgPath.startsWith('M 100 300'))

  const hex = compiled.shapes.find((s) => s.shape === 'hexagon')
  assert.ok(hex, 'Expected rotated hexagon chemical ring')
  assert.equal(hex!.rotation, 30)
  assert.equal(hex!.fillOpacity, 0.75)

  // Gapped horizontal strip should emit 4 rounded-rect codon boxes + 3 forward bound arrows
  const codonCells = compiled.shapes.filter((s) => s.shape === 'rounded-rect')
  const codonArrows = compiled.shapes.filter((s) => s.shape === 'arrow')
  assert.equal(codonCells.length, 4)
  assert.equal(codonArrows.length, 3)
  assert.ok(codonCells[1].x > codonCells[0].x + codonCells[0].w + 10, 'Explicit cellGap should space codon cells apart')
})

test('agent harness guides first-principles biological/chemical synthesis via search_board_assets', async () => {
  const emittedMutations: unknown[] = []
  let capturedSystemPrompt = ''

  const tools: AgentToolDefinition[] = [
    {
      name: 'search_board_assets',
      description: 'Discover composable board primitives, shapes, fonts, and semantic palettes before drafting visuals.',
      argHint: '{"query":"...","assetType":"all","limit":12}',
      inputSchema: z.object({
        query: z.string().optional(),
        category: z.string().optional(),
        assetType: z.enum(['shapes', 'fonts', 'colors', 'primitives', 'approaches', 'all']).optional(),
        limit: z.number().int().min(1).max(30).optional()
      }),
      execute: async (args) => {
        const res = searchBoardAssets(args)
        return {
          ok: true,
          summary: `Discovered ${res.primitives.length} primitives, ${res.shapes.length} shapes.`,
          data: res
        }
      }
    },
    {
      name: 'create_visual_tutorial',
      description: 'Create a first-principles visual tutorial.',
      argHint: '{"topic":"...","approach":"...","fontFamily":"jakarta","steps":[...]}',
      inputSchema: z.object({
        topic: z.string(),
        approach: z.string().optional(),
        fontFamily: z.enum(['jakarta', 'caveat', 'grotesk', 'mono', 'serif']).optional(),
        steps: z.array(
          z.object({
            title: z.string(),
            explanation: z.string(),
            equations: z.array(z.string()).optional(),
            scene: z.unknown().optional(),
            diagramNodes: z.array(z.unknown()).optional(),
            code: z.object({ language: z.string(), code: z.string() }).optional()
          })
        )
      }),
      execute: async (args, ctx) => {
        ctx.pushMutation({
          type: 'add_note',
          title: args.topic,
          content: args.steps.map((s) => s.title).join(' | ')
        })
        for (const step of args.steps) {
          for (const eq of step.equations ?? []) {
            ctx.pushMutation({ type: 'add_equation', latex: eq })
          }
          if (step.scene) {
            const parsed = SpatialSceneSchema.parse(normalizeSpatialSceneInput(step.scene))
            ctx.pushMutation({ type: 'add_spatial_scene', scene: parsed })
          }
        }
        return { ok: true, summary: `Created first-principles tutorial (${args.steps.length} steps).` }
      }
    }
  ]

  let turn = 0
  const replies = [
    JSON.stringify({
      thought: 'Discover composable primitives (svg_path, curved connectors, shapes) for enzyme catalysis & photosynthesis.',
      action: {
        type: 'tool',
        tool: 'search_board_assets',
        args: { query: 'enzyme catalysis activation energy chemical reaction biology', assetType: 'all', limit: 10 }
      }
    }),
    JSON.stringify({
      thought: 'Compose organelle svg_path, reaction stoichiometry in equations, and activation energy spline.',
      action: {
        type: 'tool',
        tool: 'create_visual_tutorial',
        args: {
          topic: 'Enzyme Catalysis & Activation Barrier Lowering',
          approach: 'Mechanistic binding geometry paired with reaction coordinate energetics',
          fontFamily: 'jakarta',
          steps: [
            {
              title: '1. Active-Site Binding & Reaction Coordinate',
              explanation: 'The enzyme stabilizes the transition state complex, lowering activation energy E_a.',
              equations: ['E + S \\rightleftharpoons ES \\longrightarrow E + P'],
              scene: {
                title: 'Catalyzed vs Uncatalyzed Energy Profile',
                elements: [
                  { type: 'svg_path', id: 'enzyme', d: 'M 80 180 C 160 80 280 80 320 180 C 260 220 260 280 320 320 C 240 400 100 360 80 180 Z', fill: '#DCFCE7', fillOpacity: 0.4, stroke: '#15803D' },
                  { type: 'connector', id: 'uncat', points: [[420, 680], [560, 650], [680, 220], [800, 740], [920, 760]], curved: true, style: 'dashed', arrowEnd: false, stroke: '#64748B' },
                  { type: 'connector', id: 'cat', points: [[420, 680], [560, 660], [680, 440], [800, 745], [920, 760]], curved: true, arrowEnd: true, stroke: '#16A34A', animated: true }
                ]
              }
            }
          ]
        }
      }
    }),
    JSON.stringify({
      thought: 'Finished enzyme catalysis board composition.',
      action: {
        type: 'final',
        answer: 'Created an enzyme active-site svg_path contour, catalyzed vs uncatalyzed activation curve, and equilibrium equation.'
      }
    })
  ]

  const res = await runAgentLoop({
    request: makeRequest('Explain enzyme catalysis chemically and visually on the board'),
    tools,
    onEvent: () => {},
    callLlmStep: async ({ system }) => {
      capturedSystemPrompt = system
      return replies[turn++] ?? JSON.stringify({ action: { type: 'final', answer: 'done' } })
    }
  })

  for (const m of res.mutations) emittedMutations.push(m)

  assert.equal(res.ok, true)
  assert.deepEqual(res.usedTools, ['search_board_assets', 'create_visual_tutorial'])
  assert.ok(capturedSystemPrompt.includes('FIRST-PRINCIPLES SYNTHESIS'))
  assert.ok(capturedSystemPrompt.includes('svg_path'))

  const types = emittedMutations.map((m) => (m as { type: string }).type)
  assert.equal(types.filter((t) => t === 'add_note').length, 1)
  assert.equal(types.filter((t) => t === 'add_equation').length, 1)
  assert.equal(types.filter((t) => t === 'add_spatial_scene').length, 1)
  assert.equal(types.filter((t) => t === 'add_code_card').length, 0)
  assert.equal(types.filter((t) => t === 'add_reactflow_diagram').length, 0)
})
