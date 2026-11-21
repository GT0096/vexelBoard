import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  cancelAgentRun,
  normalizeAgentEnvelopeInput,
  runAgentLoop,
  type AgentToolDefinition
} from '../src/main/agent/agentHarness.ts'
import { SpatialSceneSchema, normalizeSpatialSceneInput } from '../src/shared/beautifySchema.ts'
import { unescapeLlmCode, unescapeLlmText } from '../src/shared/textUnescape.ts'
import type { AgentRunRequest, AgentStepEvent } from '../src/shared/agentSchema.ts'

function makeRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: 'run-test-1',
    prompt: 'Fix the stack pop bug in code-1',
    mode: 'fix_code',
    provider: 'openai',
    model: 'gpt-4o',
    boardSnapshot: {
      boardId: 'sec-1',
      activeLayerId: 'layer-overlay-ink',
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
        },
        {
          id: 'layer-base-ink',
          name: 'Base Canvas',
          kind: 'ink',
          visible: true,
          locked: false,
          opacity: 1,
          order: 2
        }
      ],
      selectedIds: ['code-1'],
      viewportCenter: { x: 400, y: 300 },
      strokesCount: 0,
      notes: [],
      diagrams: [],
      codeCards: [
        {
          id: 'code-1',
          title: 'stack.py',
          activeLanguage: 'python',
          codePreview: 'def pop(s): return s.pop(0)',
          lastError: 'Wrong end popped',
          x: 100,
          y: 100,
          w: 420,
          h: 320
        }
      ],
      equations: [],
      videos: []
    },
    maxSteps: 6,
    ...overrides
  }
}

test('AgentHarness executes multi-step ReAct tool chain and preserves alternating user/assistant history', async () => {
  const events: AgentStepEvent[] = []
  const capturedHistories: Array<Array<{ role: 'user' | 'assistant'; content: string }>> = []
  let turn = 0

  const tools: AgentToolDefinition[] = [
    {
      name: 'inspect_board',
      description: 'Inspect board items',
      argHint: '{}',
      inputSchema: z.object({}),
      execute: async (_args, ctx) => ({
        ok: true,
        summary: `Inspected ${ctx.boardSnapshot.codeCards.length} code card`,
        data: { cards: ctx.boardSnapshot.codeCards }
      })
    },
    {
      name: 'run_code',
      description: 'Execute snippet',
      argHint: '{"language":"python","code":"..."}',
      inputSchema: z.object({ language: z.string(), code: z.string() }),
      execute: async (args) => ({
        ok: true,
        summary: `Ran ${args.language}`,
        data: { stdout: '3\n' }
      })
    },
    {
      name: 'create_or_patch_code',
      description: 'Patch code card',
      argHint: '{"cardId":"...","language":"python","code":"..."}',
      inputSchema: z.object({
        cardId: z.string().optional(),
        language: z.string(),
        code: z.string()
      }),
      execute: async (args, ctx) => {
        ctx.pushMutation({
          type: 'patch_code_card',
          cardId: args.cardId!,
          language: args.language,
          code: args.code
        })
        return { ok: true, summary: 'Patched code card' }
      }
    }
  ]

  const scriptedReplies = [
    '{"thought":"Inspect the selected code card first.","action":{"type":"tool","tool":"inspect_board","args":{}}}',
    '{"thought":"Test LIFO pop behavior locally.","action":{"type":"tool","tool":"run_code","args":{"language":"python","code":"s=[1,2,3]; print(s.pop())"}}}',
    '{"thought":"Verification passed, patch card code-1.","action":{"type":"tool","tool":"create_or_patch_code","args":{"cardId":"code-1","language":"python","code":"def pop(s): return s.pop()"}}}',
    '{"thought":"All complete.","action":{"type":"final","answer":"Fixed `pop()` in stack.py and verified."}}'
  ]

  const res = await runAgentLoop({
    request: makeRequest({
      chatHistory: [
        { role: 'user', content: 'Previous question about stacks' },
        { role: 'assistant', content: 'Stacks follow LIFO ordering.' }
      ]
    }),
    tools,
    onEvent: (ev) => events.push(ev),
    callLlmStep: async (args) => {
      capturedHistories.push([...args.history])
      return scriptedReplies[turn++] ?? '{"action":{"type":"final","answer":"done"}}'
    }
  })

  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 4)
  assert.deepEqual(res.usedTools, ['inspect_board', 'run_code', 'create_or_patch_code'])
  assert.equal(res.mutations.length, 1)

  // Verify strict user/assistant alternation and preservation of initial request on Step 2
  const hStep2 = capturedHistories[1]
  assert.equal(hStep2.length, 4)
  assert.deepEqual(
    hStep2.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant']
  )
  assert.ok(hStep2[2].content.includes('USER REQUEST:\nFix the stack pop bug in code-1'))

  assert.ok(events.some((e) => e.kind === 'started'))
  assert.ok(events.some((e) => e.kind === 'tool_call' && e.toolName === 'run_code'))
  assert.ok(events.some((e) => e.kind === 'mutation' && e.mutationType === 'patch_code_card'))
  assert.ok(events.some((e) => e.kind === 'final'))
})

test('AgentHarness executes batch tools action in a single step', async () => {
  const tools: AgentToolDefinition[] = [
    {
      name: 'add_note_card',
      description: 'Add note',
      argHint: '{"title":"...","content":"..."}',
      inputSchema: z.object({ title: z.string(), content: z.string() }),
      execute: async (args, ctx) => {
        ctx.pushMutation({ type: 'add_note', title: args.title, content: args.content })
        return { ok: true, summary: 'Note added' }
      }
    },
    {
      name: 'add_equation',
      description: 'Add equation',
      argHint: '{"latex":"..."}',
      inputSchema: z.object({ latex: z.string() }),
      execute: async (args, ctx) => {
        ctx.pushMutation({ type: 'add_equation', latex: args.latex })
        return { ok: true, summary: 'Equation added' }
      }
    }
  ]

  let turn = 0
  const replies = [
    '{"thought":"Add both note and equation cleanly together","action":{"type":"tools","calls":[{"tool":"add_note_card","args":{"title":"LIFO Stack","content":"Push & Pop occur at Top"}},{"tool":"add_equation","args":{"latex":"T(n)=O(1)"}}]}}',
    '{"thought":"Done","action":{"type":"final","answer":"Created LIFO Stack note and complexity equation."}}'
  ]

  const res = await runAgentLoop({
    request: makeRequest({ mode: 'general', prompt: 'Explain stack visually' }),
    tools,
    callLlmStep: async () => replies[turn++]
  })

  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 2)
  assert.equal(res.mutations.length, 2)
  assert.equal(res.mutations[0].type, 'add_note')
  assert.equal(res.mutations[1].type, 'add_equation')
})

test('AgentHarness self-corrects invalid JSON and invalid Zod tool arguments within step budget', async () => {
  const seenPrompts: string[] = []
  let runCodeCalls = 0

  const tools: AgentToolDefinition[] = [
    {
      name: 'run_code',
      description: 'Execute snippet',
      argHint: '{"language":"python","code":"..."}',
      inputSchema: z.object({
        language: z.string().min(1),
        code: z.string().min(1)
      }),
      execute: async () => {
        runCodeCalls += 1
        return { ok: true, summary: 'Executed clean' }
      }
    }
  ]

  const scriptedReplies = [
    'Here is what I think without JSON',
    '```json\n{"thought":"Run python","action":{"type":"tools","calls":[{"tool":"run_code","args":{"language":"python"}}]}}\n```',
    '{"thought":"Fix missing code arg","action":{"type":"tool","tool":"run_code","args":{"language":"python","code":"print(42)"}}}',
    '{"thought":"Finished","action":{"type":"final","answer":"Printed 42 cleanly."}}'
  ]

  let turn = 0
  const res = await runAgentLoop({
    request: makeRequest({ runId: 'run-retry-1', maxSteps: 6 }),
    tools,
    callLlmStep: async (args) => {
      seenPrompts.push(args.user)
      return scriptedReplies[turn++]
    }
  })

  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 4)
  assert.equal(runCodeCalls, 1)
  assert.ok(seenPrompts[1].includes('VALIDATION ERROR'))
  assert.ok(seenPrompts[2].includes('TOOL ARGUMENT ERROR'))
  assert.equal(res.answer, 'Printed 42 cleanly.')
})

test('AgentHarness returns ok:false instead of leaking thought when maxSteps expires with 0 mutations', async () => {
  const res = await runAgentLoop({
    request: makeRequest({ runId: 'run-exhaust-1', maxSteps: 2 }),
    tools: [],
    callLlmStep: async () =>
      '{"thought":"I will create a diagram next","action":{"type":"tool","tool":"missing_tool","args":{}}}'
  })

  assert.equal(res.ok, false)
  assert.equal(res.mutations.length, 0)
  assert.ok(res.error && res.error.includes('Unknown tool'))
})

test('AgentHarness supports mid-run cancellation via cancelAgentRun', async () => {
  const events: AgentStepEvent[] = []
  let llmCalls = 0

  const tools: AgentToolDefinition[] = [
    {
      name: 'slow_tool',
      description: 'Triggers cancellation mid-execution',
      argHint: '{}',
      inputSchema: z.object({}),
      execute: async () => {
        cancelAgentRun('run-cancel-1')
        return { ok: true, summary: 'done before abort check' }
      }
    }
  ]

  const res = await runAgentLoop({
    request: makeRequest({ runId: 'run-cancel-1' }),
    tools,
    onEvent: (ev) => events.push(ev),
    callLlmStep: async () => {
      llmCalls += 1
      return '{"thought":"Run slow tool","action":{"type":"tool","tool":"slow_tool","args":{}}}'
    }
  })

  assert.equal(res.ok, false)
  assert.equal(res.aborted, true)
  assert.equal(llmCalls, 1)
  assert.ok(events.some((e) => e.kind === 'cancelled'))
})

test('normalizeSpatialSceneInput coerces grouped LLM variants into valid SpatialSceneSchema', () => {
  const rawGrouped = {
    title: 'LIFO Stack',
    cellStrips: [
      {
        x: 340,
        y: 180,
        w: 220,
        h: 540,
        orientation: 'vertical',
        cells: ['D', 'C', 'B', 'A'],
        openEnds: ['top']
      }
    ],
    connectors: [
      {
        from: [200, 220],
        to: [200, 560],
        directed: true
      }
    ],
    texts: [
      {
        x: 100,
        y: 200,
        text: 'Entry (Push)'
      }
    ]
  }

  const normalized = normalizeSpatialSceneInput(rawGrouped)
  const parsed = SpatialSceneSchema.safeParse(normalized)
  assert.equal(parsed.success, true)
  if (parsed.success) {
    assert.equal(parsed.data.elements.length, 3)
    assert.equal(parsed.data.elements[0].type, 'cell_strip')
    if (parsed.data.elements[0].type === 'cell_strip') {
      assert.deepEqual(parsed.data.elements[0].openEnds, ['start'])
    }
    assert.equal(parsed.data.elements[1].type, 'connector')
    if (parsed.data.elements[1].type === 'connector') {
      assert.deepEqual(parsed.data.elements[1].points, [
        [200, 220],
        [200, 560]
      ])
    }
  }
})

test('unescapeLlmCode and unescapeLlmText convert literal \\n sequences into real multiline code and markdown', () => {
  const jammedCode =
    'class Node:\\n    def __init__(self, data):\\n        self.data = data\\n        self.next = None\\n\\nprint("line1\\nline2")'
  const cleanCode = unescapeLlmCode(jammedCode)
  const lines = cleanCode.split('\n')
  assert.equal(lines.length, 6)
  assert.equal(lines[0], 'class Node:')
  assert.equal(lines[1], '    def __init__(self, data):')
  assert.equal(lines[5], 'print("line1\\nline2")', 'Must preserve \\n inside string literals')

  const jammedNote =
    'Linked List\\n- Linear collection of nodes.\\n\\n### Doubly Linked List\\n- Pointers to next and prev.'
  const cleanNote = unescapeLlmText(jammedNote)
  assert.ok(cleanNote.includes('\n- Linear collection of nodes.\n\n### Doubly Linked List\n'))
  assert.equal(cleanNote.includes('\\n'), false)
})

test('normalizeAgentEnvelopeInput coerces flat answer and flat tool call envelopes without schema failure', async () => {
  const flatAnswer = normalizeAgentEnvelopeInput({
    thought: 'Direct conceptual answer',
    answer: 'A **Linked List** is a linear collection of nodes.'
  }) as Record<string, unknown>
  assert.deepEqual(flatAnswer.action, {
    type: 'final',
    answer: 'A **Linked List** is a linear collection of nodes.'
  })

  const res = await runAgentLoop({
    request: makeRequest({ mode: 'general', prompt: 'What is a linked list?' }),
    tools: [],
    callLlmStep: async () =>
      JSON.stringify({
        thought: 'Explain linked list clearly',
        answer: 'A **Linked List** stores elements in nodes linked by pointers.\\n- Head points to first node'
      })
  })
  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 1)
  assert.ok(res.answer.includes('\n- Head points to first node'))
})
