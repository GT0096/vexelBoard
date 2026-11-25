import { z } from 'zod'
import { SpatialSceneSchema, normalizeSpatialSceneInput } from '../../shared/beautifySchema'
import { AgentAnnotationItemSchema } from '../../shared/agentSchema'
import { unescapeLlmCode, unescapeLlmText } from '../../shared/textUnescape'
import { inferPedagogicalApproach, searchBoardAssets } from '../../shared/boardCatalog'
import { runCodeSnippet } from '../codeRunner'
import { dbManager } from '../db'
import { fetchYouTubeInfo } from '../mediaService'
import { getSkillDetail, listAllSkills } from '../skillManager'
import { fetchWebPage, webSearch as runWebSearch } from '../webSearch'
import { defineAgentTool, type AgentToolDefinition } from './agentHarness'

export interface AgentToolDeps {
  db?: typeof dbManager
  runCode?: typeof runCodeSnippet
  fetchYouTube?: typeof fetchYouTubeInfo
  webSearch?: typeof runWebSearch
  fetchPage?: typeof fetchWebPage
}

export function createAgentTools(deps: AgentToolDeps = {}): AgentToolDefinition[] {
  const db = deps.db ?? dbManager
  const runCode = deps.runCode ?? runCodeSnippet
  const fetchYouTube = deps.fetchYouTube ?? fetchYouTubeInfo
  const webSearch = deps.webSearch ?? runWebSearch
  const fetchPage = deps.fetchPage ?? fetchWebPage

  return [
    defineAgentTool({
      name: 'inspect_board',
      description:
        'Inspect detailed elements currently on the board (layers, notes, diagrams, code cards, equations, videos, and suggestedEmptyArea).',
      argHint: '{"includeRecentHistory":true}',
      inputSchema: z.object({
        includeRecentHistory: z.boolean().optional()
      }),
      execute: async (args, ctx) => {
        const snap = ctx.boardSnapshot
        const recentHistory = args.includeRecentHistory
          ? db.getHistoryEvents(snap.boardId, 15).map((ev) => ({
              eventType: ev.eventType,
              elementId: ev.elementId,
              description: ev.description
            }))
          : []

        return {
          ok: true,
          summary: `Board has ${snap.strokesCount} strokes, ${snap.notes.length} notes, ${snap.diagrams.length} diagrams, ${snap.codeCards.length} code cards, ${snap.equations.length} equations, ${snap.knowledgeSourceCount ?? 0} indexed sources.`,
          data: {
            layers: snap.layers,
            activeLayerId: snap.activeLayerId,
            selectedIds: snap.selectedIds,
            selectionBounds: snap.selectionBounds,
            viewportCenter: snap.viewportCenter,
            suggestedEmptyArea: snap.suggestedEmptyArea,
            notes: snap.notes,
            diagrams: snap.diagrams,
            codeCards: snap.codeCards,
            equations: snap.equations,
            videos: snap.videos,
            recentHistory
          }
        }
      }
    }),
    defineAgentTool({
      name: 'find_empty_canvas_area',
      description:
        'Return the pre-computed empty world coordinate region where new visuals will be placed without overlapping existing ink or cards.',
      argHint: '{}',
      inputSchema: z.object({}),
      execute: async (_args, ctx) => {
        const snap = ctx.boardSnapshot
        return {
          ok: true,
          summary: snap.suggestedEmptyArea
            ? `Empty canvas area available at (${snap.suggestedEmptyArea.x}, ${snap.suggestedEmptyArea.y}) size ${snap.suggestedEmptyArea.width}x${snap.suggestedEmptyArea.height}. Omit x/y in creation tools to auto-pack there.`
            : `Viewport center is (${snap.viewportCenter.x}, ${snap.viewportCenter.y}). Omit x/y in creation tools for automatic empty-area placement.`,
          data: {
            suggestedEmptyArea: snap.suggestedEmptyArea,
            viewportCenter: snap.viewportCenter
          }
        }
      }
    }),
    defineAgentTool({
      name: 'search_board_assets',
      description:
        'Discover Vexelboard first-principles composable primitives (shapes with radial cx/cy/r & fillOpacity, arbitrary svg_path Bezier contours, smooth multi-point curved & animated connectors, contiguous/cellGap cell_strips), registered shape library IDs, fonts, and semantic palettes before drafting any diagram or tutorial.',
      argHint: '{"query":"atomic orbital photon emission","assetType":"all","limit":12}',
      inputSchema: z.object({
        query: z.string().optional(),
        category: z.string().optional(),
        assetType: z
          .enum(['shapes', 'fonts', 'colors', 'primitives', 'approaches', 'all'])
          .optional(),
        limit: z.number().int().min(1).max(30).optional()
      }),
      execute: async (args) => {
        const found = searchBoardAssets(args)
        return {
          ok: true,
          summary: `Discovered ${found.primitives.length} composable primitive(s), ${found.shapes.length} shape(s), ${found.fonts.length} font(s), and ${found.colorPalettes.length} semantic palette(s).`,
          data: found
        }
      }
    }),
    defineAgentTool({
      name: 'list_project_sources',
      description: 'List uploaded PDFs, documents, and YouTube sources indexed in the Knowledge Hub.',
      argHint: '{"includeSummaries":true}',
      inputSchema: z.object({
        includeSummaries: z.boolean().optional()
      }),
      execute: async (args, ctx) => {
        const sources = db.getKnowledgeSources(
          ctx.boardSnapshot.boardId,
          ctx.boardSnapshot.projectId
        )
        const list = sources.slice(0, 25).map((s) => ({
          id: s.id,
          title: s.title,
          sourceType: s.sourceType,
          sourceUrl: s.sourceUrl,
          summary: args.includeSummaries === false ? undefined : s.summary
        }))
        return {
          ok: true,
          summary: `Found ${sources.length} Knowledge Hub source(s).`,
          data: list
        }
      }
    }),
    defineAgentTool({
      name: 'search_knowledge_base',
      description:
        'Run hybrid vector+keyword search over indexed PDFs, documents, and YouTube transcripts.',
      argHint: '{"query":"stack push pop complexity","limit":5}',
      inputSchema: z.object({
        query: z.string().min(1),
        sourceIds: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(12).optional()
      }),
      execute: async (args, ctx) => {
        const targetSourceIds =
          args.sourceIds && args.sourceIds.length > 0 ? args.sourceIds : ctx.selectedSourceIds
        const hits = db.hybridSearch(args.query, {
          sourceIds: targetSourceIds,
          limit: args.limit ?? 6
        })
        const sources = db.getKnowledgeSourcesByIds(
          Array.from(new Set(hits.map((h) => h.sourceId)))
        )
        const titleMap = new Map(sources.map((s) => [s.id, s.title]))
        return {
          ok: true,
          summary: `Retrieved ${hits.length} relevant chunk(s) for "${args.query}".`,
          data: hits.map((h) => ({
            chunkId: h.chunkId,
            sourceId: h.sourceId,
            sourceTitle: titleMap.get(h.sourceId) || h.sourceTitle || h.sourceId,
            score: Number(h.score.toFixed(3)),
            metadata: h.metadata,
            content: h.chunkText
          }))
        }
      }
    }),
    defineAgentTool({
      name: 'web_search',
      description:
        "Search the live internet using Vexelboard's built-in open metasearch (DuckDuckGo, Wikipedia, arXiv, Stack Overflow, Hacker News, OpenAlex, or optional SearXNG) for current or external information. Returns titles, URLs and snippets.",
      argHint: '{"query":"latest React 19 features","limit":6,"timeRange":"year"}',
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(10).optional(),
        timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
        site: z.string().optional(),
        category: z.enum(['general', 'news', 'science', 'it']).optional()
      }),
      execute: async (args, ctx) => {
        if (ctx.webSearch?.enabled === false) {
          return {
            ok: false,
            summary: 'Web search disabled in Settings'
          }
        }
        const res = await webSearch(
          args.query,
          {
            limit: args.limit,
            timeRange: args.timeRange,
            site: args.site,
            category: args.category
          },
          ctx.webSearch ?? {},
          ctx.signal
        )
        if (!res.ok) {
          return {
            ok: false,
            summary: res.error || `No web results found for "${args.query}".`,
            data: { provider: res.provider, attempts: res.attempts, results: [] }
          }
        }
        return {
          ok: true,
          summary: `Found ${res.results.length} web result(s) via ${res.provider} for "${args.query}".`,
          data: {
            provider: res.provider,
            answers: res.answers,
            results: res.results.map((r, i) => ({
              rank: i + 1,
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              publishedDate: r.publishedDate
            }))
          }
        }
      }
    }),
    defineAgentTool({
      name: 'fetch_webpage',
      description:
        'Fetch a public web page or PDF and extract its readable main text (Mozilla Readability). Pass `query` to keep the most relevant passages.',
      argHint: '{"url":"https://react.dev/blog","query":"hooks API changes","maxChars":3500}',
      inputSchema: z.object({
        url: z.string().url(),
        query: z.string().optional(),
        maxChars: z.number().int().min(500).max(6000).optional()
      }),
      execute: async (args, ctx) => {
        const page = await fetchPage(args.url, {
          query: args.query,
          maxChars: args.maxChars,
          signal: ctx.signal
        })
        if (!page.ok) {
          return {
            ok: false,
            summary: page.error || `Failed to read ${args.url}.`
          }
        }
        let host = args.url
        try {
          host = new URL(page.finalUrl || args.url).hostname
        } catch {
          // keep fallback
        }
        return {
          ok: true,
          summary: `Read "${page.title || host}" (${page.content.length} chars${page.truncated ? ', truncated' : ''}) from ${host}.`,
          data: {
            url: page.finalUrl || page.url,
            title: page.title,
            siteName: page.siteName,
            byline: page.byline,
            excerpt: page.excerpt,
            content: page.content
          }
        }
      }
    }),
    defineAgentTool({
      name: 'run_code',
      description: 'Execute a code snippet locally to verify behavior, tests, or bug fixes.',
      argHint: '{"language":"python","code":"print(1 + 1)","stdin":""}',
      inputSchema: z.object({
        language: z.string().min(1),
        code: z.string().min(1),
        stdin: z.string().optional()
      }),
      execute: async (args) => {
        const cleanCode = unescapeLlmCode(args.code)
        const res = await runCode({
          language: args.language,
          code: cleanCode,
          stdin: args.stdin,
          timeoutMs: 10000
        })
        return {
          ok: res.ok,
          summary: res.ok
            ? `Executed ${args.language} successfully in ${res.durationMs}ms.`
            : `Execution failed (${res.error || `exit ${res.exitCode}`}).`,
          data: {
            ok: res.ok,
            exitCode: res.exitCode,
            durationMs: res.durationMs,
            stdout: res.stdout,
            stderr: res.stderr,
            error: res.error,
            timedOut: res.timedOut
          }
        }
      }
    }),
    defineAgentTool({
      name: 'fetch_youtube',
      description:
        'Fetch metadata and transcript chunks for a YouTube video URL, optionally pinning a video card onto an empty area of the board.',
      argHint: '{"url":"https://youtube.com/watch?v=...","addToBoard":true}',
      inputSchema: z.object({
        url: z.string().min(4),
        addToBoard: z.boolean().optional(),
        x: z.number().optional(),
        y: z.number().optional()
      }),
      execute: async (args, ctx) => {
        const info = await fetchYouTube(args.url)
        if (!info.ok) {
          return {
            ok: false,
            summary: info.error || 'Failed to fetch YouTube video details.'
          }
        }
        if (args.addToBoard) {
          ctx.pushMutation({
            type: 'add_video_card',
            title: info.title,
            url: `https://www.youtube.com/watch?v=${info.videoId}`,
            videoId: info.videoId,
            summary: info.chunks[0]?.text.slice(0, 320),
            transcriptExcerpt: info.fullText.slice(0, 600),
            x: args.x,
            y: args.y
          })
        }
        return {
          ok: true,
          summary: `Fetched YouTube "${info.title}" (${info.chunks.length} transcript chunks).`,
          data: {
            videoId: info.videoId,
            title: info.title,
            author: info.author,
            hasCaptions: info.hasCaptions,
            transcriptPreview: info.fullText.slice(0, 1800)
          }
        }
      }
    }),
    defineAgentTool({
      name: 'add_note_card',
      description:
        'Add a structured Markdown sticky note card into an empty area of the canvas (omit x/y for automatic empty-area placement). Use `search_board_assets` to discover domain colors if desired.',
      argHint: '{"title":"Key Takeaways","content":"- Point 1\\n- Point 2"}',
      inputSchema: z.object({
        title: z.string().optional(),
        content: z.string().min(1),
        x: z.number().optional(),
        y: z.number().optional(),
        w: z.number().optional(),
        h: z.number().optional(),
        color: z.string().optional()
      }),
      execute: async (args, ctx) => {
        ctx.pushMutation({
          type: 'add_note',
          title: args.title,
          content: unescapeLlmText(args.content),
          x: args.x,
          y: args.y,
          w: args.w,
          h: args.h,
          color: args.color
        })
        return { ok: true, summary: `Queued note card "${args.title || 'Note'}".` }
      }
    }),
    defineAgentTool({
      name: 'annotate_canvas',
      description:
        'Draw clean overlay annotations (arrows, circles, rectangles, highlight underlines, and callout text) onto "layer-overlay-ink" above existing items.',
      argHint:
        '{"layerId":"layer-overlay-ink","annotations":[{"kind":"arrow","x":100,"y":120,"toX":240,"toY":180},{"kind":"text","x":100,"y":90,"text":"Key annotation","fontSize":16}]}',
      inputSchema: z.object({
        layerId: z.string().optional(),
        annotations: z.array(AgentAnnotationItemSchema).min(1).max(30)
      }),
      execute: async (args, ctx) => {
        ctx.pushMutation({
          type: 'annotate_overlay',
          layerId: args.layerId || 'layer-overlay-ink',
          annotations: args.annotations
        })
        return {
          ok: true,
          summary: `Queued ${args.annotations.length} overlay annotation(s) on ${args.layerId || 'layer-overlay-ink'}.`
        }
      }
    }),
    defineAgentTool({
      name: 'create_vector_diagram',
      description:
        'Compose ANY 2D scientific, mathematical, biological, chemical, physical, or computational visual directly on the canvas from first-principles SpatialScene primitives (0..1000 coords): `shape` (any primitive/library shape with x/y/w/h or cx/cy/r, fillOpacity, rotation, strokeStyle, animated), `svg_path` (arbitrary custom Bezier d paths for organelles/membranes/wells/lenses), `connector` (vectors, quadratic arcs, or 4+ pt smooth Catmull-Rom splines with curved:true and animated:true pulse/dash waves), `cell_strip` (contiguous arrays/stacks or cellGap + connectorArrows codon/polymer/list chains), and `text`. Omit outer x/y to auto-place in an empty region.',
      argHint:
        '{"title":"Bohr Transition & Photon Emission","scene":{"title":"Atomic Transition","elements":[{"type":"shape","id":"n2","kind":"circle","cx":500,"cy":500,"r":260,"fill":"transparent","stroke":"#38BDF8","strokeStyle":"dashed"},{"type":"shape","id":"nucleus","kind":"circle","cx":500,"cy":500,"r":44,"fill":"#EF4444","label":"+Ze"},{"type":"svg_path","id":"orbital_well","d":"M 120 820 C 300 820 350 760 500 500","stroke":"#8B5CF6","fill":"transparent","strokeWidth":2.5},{"type":"connector","id":"photon","points":[[620,420],[700,360],[780,420],[860,360],[940,420]],"curved":true,"arrowEnd":true,"animated":true,"pulseColor":"#F59E0B","label":"hν"},{"type":"text","id":"lbl","x":500,"y":120,"text":"ΔE = hf","fontSize":18,"bold":true,"align":"center"}]}}',
      inputSchema: z.object({
        title: z.string().optional(),
        scene: z.unknown(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional()
      }),
      execute: async (args, ctx) => {
        const normalized = normalizeSpatialSceneInput(args.scene)
        const parsed = SpatialSceneSchema.safeParse(normalized)
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || 'scene'}: ${i.message}`)
            .join('; ')
          return {
            ok: false,
            summary: `Invalid SpatialScene payload (${issues}). Required format: {"title":"...","elements":[{"type":"shape"|"svg_path"|"connector"|"cell_strip"|"text", ...}]}.`
          }
        }
        ctx.pushMutation({
          type: 'add_spatial_scene',
          title: args.title || parsed.data.title,
          scene: parsed.data,
          x: args.x,
          y: args.y,
          width: args.width,
          height: args.height
        })
        return {
          ok: true,
          summary: `Queued native SpatialScene vector diagram "${args.title || parsed.data.title || 'Vector Diagram'}" (${parsed.data.elements.length} primitives).`
        }
      }
    }),
    defineAgentTool({
      name: 'create_interactive_diagram',
      description:
        'Create a board-native connected diagram (flowchart, mindmap, architecture, erd, sequence, or concept) built directly on the canvas with native board shapes and live bound orthogonal connectors (set animated:true for traveling signal pulse waves).',
      argHint:
        '{"title":"Push / Pop Flow","diagramType":"flowchart","direction":"TB","animated":true,"nodes":[{"id":"n1","label":"Check Full"},{"id":"n2","label":"Increment Top"}],"edges":[{"source":"n1","target":"n2","label":"Not full","animated":true}]}',
      inputSchema: z.object({
        title: z.string().min(1),
        diagramType: z
          .enum(['flowchart', 'mindmap', 'architecture', 'erd', 'sequence', 'concept'])
          .optional(),
        direction: z.enum(['TB', 'LR']).optional(),
        animated: z.boolean().optional(),
        nodes: z
          .array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              kind: z.string().optional(),
              type: z.string().optional(),
              subtitle: z.string().optional(),
              description: z.string().optional(),
              shape: z.string().optional(),
              group: z.string().optional(),
              layer: z.number().optional()
            })
          )
          .min(1)
          .max(40),
        edges: z
          .array(
            z.object({
              id: z.string().optional(),
              source: z.string().optional(),
              target: z.string().optional(),
              from: z.string().optional(),
              to: z.string().optional(),
              label: z.string().optional(),
              style: z.string().optional(),
              animated: z.boolean().optional()
            })
          )
          .max(80)
          .default([]),
        x: z.number().optional(),
        y: z.number().optional()
      }),
      execute: async (args, ctx) => {
        const cleanNodes = args.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind ?? n.type,
          subtitle: n.subtitle ?? n.description,
          shape: n.shape,
          group: n.group,
          layer: n.layer
        }))
        const cleanEdges = args.edges
          .map((e, idx) => ({
            id: e.id || `edge-${idx + 1}`,
            source: e.source || e.from || '',
            target: e.target || e.to || '',
            label: e.label,
            style: e.style,
            animated: e.animated ?? args.animated
          }))
          .filter((e) => e.source.length > 0 && e.target.length > 0)

        ctx.pushMutation({
          type: 'add_reactflow_diagram',
          title: args.title,
          diagramType: args.diagramType ?? 'flowchart',
          direction: args.direction ?? 'TB',
          animated: args.animated,
          nodes: cleanNodes,
          edges: cleanEdges,
          x: args.x,
          y: args.y
        })
        return {
          ok: true,
          summary: `Queued board-native ${args.diagramType || 'flowchart'} "${args.title}" (${cleanNodes.length} shapes, ${cleanEdges.length} bound connectors).`
        }
      }
    }),
    defineAgentTool({
      name: 'create_or_patch_code',
      description:
        'Create a runnable Code Card in an empty area of the board OR patch an existing Code Card when `cardId` is supplied.',
      argHint: '{"cardId":"optional-id","title":"stack.py","language":"python","code":"class Stack: ..."}',
      inputSchema: z.object({
        cardId: z.string().optional(),
        title: z.string().optional(),
        language: z.string().min(1),
        code: z.string().min(1),
        x: z.number().optional(),
        y: z.number().optional()
      }),
      execute: async (args, ctx) => {
        const cleanCode = unescapeLlmCode(args.code)
        if (args.cardId && args.cardId.trim()) {
          ctx.pushMutation({
            type: 'patch_code_card',
            cardId: args.cardId.trim(),
            language: args.language,
            code: cleanCode,
            title: args.title
          })
          return {
            ok: true,
            summary: `Queued patch for Code Card "${args.cardId}" (${args.language}).`
          }
        }
        ctx.pushMutation({
          type: 'add_code_card',
          title: args.title || `snippet.${args.language}`,
          language: args.language,
          code: cleanCode,
          x: args.x,
          y: args.y
        })
        return {
          ok: true,
          summary: `Queued runnable ${args.language} Code Card "${args.title || 'Code Snippet'}".`
        }
      }
    }),
    defineAgentTool({
      name: 'create_visual_tutorial',
      description:
        'Create a first-principles visual tutorial tailored uniquely to any phenomenon (atomic/quantum physics, organic chemistry/reactions, cellular biology, mathematics, quantitative markets, software systems, etc.). Call `search_board_assets` first to inspect available primitives (`shape`, `svg_path`, curved/animated `connector`, `cell_strip`, `text`), catalog shapes, fonts, and semantic colors. Emit ONLY the primitives each step genuinely needs.',
      argHint:
        '{"topic":"Enzyme-Catalyzed Reaction & Activation Barrier","approach":"First-principles activation profile & active-site conformational diagram","pedagogicalRationale":"Combines substrate binding geometry with catalytic enthalpy curve and Arrhenius kinetics.","overview":"Catalysts lower activation energy via transition-state stabilization without shifting equilibrium.","steps":[{"title":"1. Induced Fit & Transition State","explanation":"Active-site geometry stabilizes the transition state complex.","equations":["E + S \\\\rightleftharpoons ES \\\\longrightarrow E + P"],"scene":{"title":"Reaction Profile","elements":[{"type":"connector","id":"uncat","points":[[120,660],[340,620],[500,200],[660,720],[860,760]],"curved":true,"style":"dashed","stroke":"#64748B"},{"type":"connector","id":"cat","points":[[120,660],[340,635],[500,400],[660,725],[860,760]],"curved":true,"arrowEnd":true,"stroke":"#16A34A"}]}}]}',
      inputSchema: z.object({
        topic: z.string().min(1),
        overview: z.string().min(1),
        approach: z.string().optional(),
        pedagogicalRationale: z.string().optional(),
        fontFamily: z.string().optional(),
        steps: z
          .array(
            z.object({
              title: z.string().min(1),
              explanation: z.string().min(1),
              keyPoints: z.array(z.string()).optional(),
              equations: z.array(z.string()).optional(),
              equationLatex: z.string().optional(),
              scene: z.unknown().optional(),
              diagramNodes: z
                .array(
                  z.object({
                    id: z.string().min(1),
                    label: z.string().min(1),
                    kind: z.string().optional(),
                    type: z.string().optional(),
                    subtitle: z.string().optional(),
                    description: z.string().optional()
                  })
                )
                .optional(),
              diagramEdges: z
                .array(
                  z.object({
                    id: z.string().optional(),
                    source: z.string().optional(),
                    target: z.string().optional(),
                    from: z.string().optional(),
                    to: z.string().optional(),
                    label: z.string().optional()
                  })
                )
                .optional(),
              language: z.string().optional(),
              code: z.string().optional()
            })
          )
          .min(1)
          .max(8)
      }),
      execute: async (args, ctx) => {
        const discovered = searchBoardAssets({ query: args.topic, assetType: 'all', limit: 10 })
        const inferred = inferPedagogicalApproach(args.topic)
        const approachName = args.approach || inferred.name
        const palette = discovered.colorPalettes[0]
        const bannerColor = palette?.noteCardFill

        const colStride = 560
        const cardW = 520
        const bannerW = Math.min(1640, Math.max(cardW, args.steps.length * colStride - 40))
        const roadmap = args.steps
          .map((s, idx) => `**${idx + 1}.** ${s.title.replace(/^\d+[.)]\s*/, '')}`)
          .join('  →  ')
        const approachLine = args.pedagogicalRationale
          ? `\n\n**Teaching Approach (${approachName}):** ${unescapeLlmText(args.pedagogicalRationale)}`
          : `\n\n**Teaching Approach:** ${approachName}`
        const bannerH = args.pedagogicalRationale ? 205 : 185

        ctx.pushMutation({
          type: 'add_note',
          title: `Tutorial: ${args.topic}`,
          content: `# 🎓 ${args.topic}\n\n${unescapeLlmText(args.overview)}${approachLine}\n\n**Roadmap:** ${roadmap}`,
          x: 0,
          y: 0,
          w: bannerW,
          h: bannerH,
          color: bannerColor
        })

        let createdCount = 1
        const stepStartY = bannerH + 30

        args.steps.forEach((st, idx) => {
          const colX = idx * colStride
          const cleanTitle = st.title.replace(/^\d+[.)]\s*/, '')
          const stepHeader = `${idx + 1}. ${cleanTitle}`
          const bullets = (st.keyPoints ?? [])
            .map((k) => `- ${unescapeLlmText(k)}`)
            .join('\n')
          const noteBody = [
            `### ${stepHeader}`,
            '',
            unescapeLlmText(st.explanation),
            bullets ? `\n#### Key Takeaways\n${bullets}` : ''
          ]
            .filter(Boolean)
            .join('\n')

          const noteH = Math.max(190, Math.min(310, Math.round(130 + (noteBody.length / 46) * 18)))
          let curY = stepStartY

          ctx.pushMutation({
            type: 'add_note',
            title: stepHeader,
            content: noteBody,
            x: colX,
            y: curY,
            w: cardW,
            h: noteH
          })
          createdCount += 1
          curY += noteH + 24

          const stepEquations = Array.from(
            new Set(
              [...(st.equations ?? []), ...(st.equationLatex ? [st.equationLatex] : [])]
                .map((eq) => eq.trim())
                .filter(Boolean)
            )
          )
          for (const eq of stepEquations) {
            ctx.pushMutation({
              type: 'add_equation',
              latex: eq,
              x: colX,
              y: curY
            })
            createdCount += 1
            curY += 108
          }

          let hasVisual = false
          if (st.scene) {
            const normalized = normalizeSpatialSceneInput(st.scene)
            const parsedScene = SpatialSceneSchema.safeParse(normalized)
            if (parsedScene.success) {
              ctx.pushMutation({
                type: 'add_spatial_scene',
                title: stepHeader,
                scene: parsedScene.data,
                x: colX,
                y: curY,
                width: cardW,
                height: 330
              })
              hasVisual = true
              createdCount += 1
              curY += 360
            }
          }

          if (!hasVisual && st.diagramNodes && st.diagramNodes.length > 0) {
            const cleanNodes = st.diagramNodes.map((n) => ({
              id: n.id,
              label: n.label,
              kind: n.kind ?? n.type,
              subtitle: n.subtitle ?? n.description
            }))
            const cleanEdges = (st.diagramEdges ?? [])
              .map((e, eIdx) => ({
                id: e.id || `e-${eIdx + 1}`,
                source: e.source || e.from || '',
                target: e.target || e.to || '',
                label: e.label
              }))
              .filter((e) => e.source.length > 0 && e.target.length > 0)

            ctx.pushMutation({
              type: 'add_reactflow_diagram',
              title: stepHeader,
              diagramType: 'flowchart',
              direction: 'LR',
              nodes: cleanNodes,
              edges: cleanEdges,
              x: colX,
              y: curY
            })
            createdCount += 1
            curY += 340
          }

          if (st.code && st.code.trim()) {
            const lang = st.language || 'python'
            const ext = lang === 'javascript' ? 'js' : lang === 'typescript' ? 'ts' : 'py'
            const slug = cleanTitle
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '')
              .slice(0, 24) || `step_${idx + 1}`
            ctx.pushMutation({
              type: 'add_code_card',
              title: `${slug}.${ext}`,
              language: lang,
              code: unescapeLlmCode(st.code),
              x: colX,
              y: curY
            })
            createdCount += 1
          }
        })

        return {
          ok: true,
          summary: `Queued domain-adaptive ${args.steps.length}-step tutorial "${args.topic}" (${approachName}, ${createdCount} aligned board items).`
        }
      }
    }),
    defineAgentTool({
      name: 'add_equation',
      description:
        'Place a rendered KaTeX LaTeX equation card into an empty area of the canvas (omit x/y for automatic placement).',
      argHint: '{"title":"Time Complexity","latex":"T(n) = O(1)\\\\text{ push/pop}"}',
      inputSchema: z.object({
        latex: z.string().min(1),
        title: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional()
      }),
      execute: async (args, ctx) => {
        ctx.pushMutation({
          type: 'add_equation',
          latex: args.latex,
          title: args.title,
          x: args.x,
          y: args.y
        })
        return {
          ok: true,
          summary: `Queued LaTeX equation card${args.title ? ` "${args.title}"` : ''}.`
        }
      }
    }),
    defineAgentTool({
      name: 'list_skills',
      description:
        'Search or list available AI workflow skills (Antigravity SKILL.md workspace, global, plugin, custom, and built-in Vexelboard skills).',
      argHint: '{"query":"architecture diagram","source":"all"}',
      inputSchema: z.object({
        query: z.string().optional(),
        source: z
          .enum(['all', 'workspace', 'custom', 'antigravity', 'antigravity-plugin', 'builtin'])
          .optional()
      }),
      execute: async (args) => {
        const all = listAllSkills()
        const src = args.source ?? 'all'
        const q = (args.query || '').trim().toLowerCase()
        const tokens = q ? q.split(/\s+/).filter(Boolean) : []
        const filtered = all
          .filter((s) => (src === 'all' ? true : s.source === src))
          .filter((s) => {
            if (tokens.length === 0) return true
            const hay = `${s.name} ${s.description}`.toLowerCase()
            return tokens.some((t) => hay.includes(t))
          })
          .slice(0, 30)
          .map((s) => ({
            id: s.id,
            name: s.name,
            source: s.source,
            description: s.description,
            hasReferences: Boolean(s.hasReferences),
            hasScripts: Boolean(s.hasScripts)
          }))
        return {
          ok: true,
          summary: `Found ${filtered.length} matching skill(s).`,
          data: filtered
        }
      }
    }),
    defineAgentTool({
      name: 'activate_skill',
      description:
        'Load the full SKILL.md procedure (and optional reference file) for an AI workflow skill by name or ID.',
      argHint: '{"name":"vexel-architecture-visualizer"}',
      inputSchema: z.object({
        name: z.string().min(1),
        referenceFile: z.string().optional()
      }),
      execute: async (args) => {
        const detail = getSkillDetail(args.name, args.referenceFile)
        if (!detail) {
          return {
            ok: false,
            summary: `Skill "${args.name}" not found. Call list_skills to inspect available skills.`
          }
        }
        return {
          ok: true,
          summary: `Activated skill "${detail.name}" (${detail.source}). Follow its instructions.`,
          data: {
            name: detail.name,
            source: detail.source,
            description: detail.description,
            instructions: detail.body.slice(0, 5500),
            referenceFiles: detail.referenceFiles,
            scriptFiles: detail.scriptFiles
          }
        }
      }
    })
  ]
}
