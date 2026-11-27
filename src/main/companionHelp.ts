/**
 * Compact, always-accurate cheat-sheets served by the Vexelboard companion bridge
 * (MCP `vexelboard_help`, MCP `initialize.instructions`, REST `/api/help`, `vexel.mjs help`).
 *
 * Purpose: external agents (Antigravity, Claude) can create/modify board content with ONE small
 * call instead of grepping/reading the app's source code to learn payload shapes.
 */

export const COMPANION_INSTRUCTIONS = [
  'Vexelboard companion: you can draw on the user\'s LIVE whiteboard through the vexelboard_* MCP tools (or `node .agents/skills/vexelboard-canvas/scripts/vexel.mjs <cmd>`).',
  'Do NOT read, grep, or edit the Vexelboard app source (src/**) to place or change board content: payload shapes are documented in the tool schemas and in `vexelboard_help` (topics: graph, diagram, scene, 3d, code, pipeline, connect, all).',
  'Workflow: (1) vexelboard_inspect_board only if you need existing element IDs/positions, (2) call the create tool directly (omit x/y so cards auto-place in empty space), (3) if a call returns an error, fix the payload using the error text or `vexelboard_help`, never by reading source.',
  'Use deterministic `id`s when wiring cards (Code -> Code -> Graph/3D) with vexelboard_connect_elements. Use `replaceElementIds` to swap a rough sketch for a clean result.'
].join('\n')

const GRAPH = `GRAPH CARD  (vexelboard_create_graph | vexel.mjs add-graph)
chartType: function line smooth area bar histogram scatter pie violin box candlestick heatmap surface3d scatter3d line3d bar3d
Call: { chartType, title, data:{...}, id?, cardId?(update existing), x?, y?, width?, height? }
data shapes:
  function:  {"expr":"sin(x)+0.3*x","xMin":-6,"xMax":6} | {"functions":[{"expr":"sin(x)","color":"#2563EB"}]}
  x/y:       {"x":[1,2,3],"y":[4,5,6]} | {"x":[1,2,3],"series":[{"label":"A","y":[..],"color":"#2563EB"}]}
  1D stats (bar/histogram/pie/violin/box): {"x":[12,15,18,22],"bins":8,"showKde":true}
  candlestick: {"x":["Mon","Tue"],"open":[..],"high":[..],"low":[..],"close":[..]}
  3D points/lines/bars: {"x":[..],"y":[..],"z":[..]}
  3D surface / heatmap: {"expr3d":"sin(x)*cos(y)"} | {"z":[[1,2],[3,4]]}
style keys (optional): color backgroundColor axisColor gridColor textColor axisStyle(origin|frame|box|none) showGrid showLegend legendPosition(bottom|top|right|inside) donut showTrendline bullColor bearColor`

const DIAGRAM = `DIAGRAM  (vexelboard_create_diagram | vexel.mjs add-diagram)
{ title, diagramType(flowchart|mindmap|architecture|erd|sequence|concept), direction(TB|LR), animated?,
  nodes:[{id,label,type?(process|decision|database|cloud|actor|start|end|note|group),description?}],
  edges:[{source,target,label?,animated?}], x?, y?, replaceElementIds? }
Use for node-and-arrow diagrams. Edges reference node ids.`

const SCENE = `VECTOR SCENE  (vexelboard_create_vector_scene | vexel.mjs add-scene)
{ title, scene:{ elements:[...] }, x?, y?, width?, height?, replaceElementIds? }   coordinates are a 0..1000 local box
element types:
  shape:      {type:"shape",id,kind:"rect|rounded_rect|ellipse|circle|diamond|triangle|cylinder|parallelogram|hexagon",x,y,w,h | cx,cy,r,fill?,stroke?,fillOpacity?,strokeStyle?,label?}
  connector:  {type:"connector",id,points:[[x1,y1],[x2,y2],...],curved?,arrowEnd?,arrowStart?,style?,label?,fromId?,toId?}
  text:       {type:"text",id,x,y,text,fontSize?,bold?,align?(left|center|right)}
  cell_strip: {type:"cell_strip",id,orientation:"vertical|horizontal",x,y,w,h,cells:["a","b"],openEnds?:["start"|"end"],cellGap?,connectorArrows?}
  svg_path:   {type:"svg_path",id,d:"M .. C .. Z",stroke?,fill?,strokeWidth?}
Use for stacks/queues/arrays, geometry, illustrations, anything whose exact layout matters.`

const THREE_D = `3D SCENE  (vexelboard_create_3d_scene | vexel.mjs add-3d)
{ id?, title?, preset?, scene?:{title,preset?,elements:[...]}, immersed?(default true), x?, y?, width?, height? }
presets: car optics_bench mechanics_rig chemistry_setup electromagnetism surface_wave
element types: box sphere cylinder cone torus wheel spring lens prism flask plane arrow3d curve3d surface3d(expr:"sin(x)*cos(y)",xRange,zRange) mesh label3d
common element keys: id type color position:[x,y,z] size/radius/from:[..]/to:[..] anim:{pulseFlow:true}`

const CODE = `CODE CARD  (vexelboard_add_code_card | vexel.mjs add-code)
{ id?, cardId?(patch existing), title, language(python|javascript|typescript|cpp|c|java|go|rust|r|ruby|php|csharp|powershell|bash|lua|perl), code, tabs?, pipelineMode? }
Python auto-emits JSON from returned dicts, top-level x=[..]/y=[..], or a trailing expression.`

const PIPELINE = `PIPELINE  (Code -> Code -> Graph/3D)   vexel.mjs add-pipeline --json '{"stages":[{"title":"1.py","code":".."},{"title":"2.py","code":"def transform(data): ..."}],"graph":{"chartType":"bar","title":".."}}'
MCP equivalent: vexelboard_add_code_card (give ids) + vexelboard_create_graph (id) + vexelboard_connect_elements.
Downstream Python receives upstream output via def transform(data):, INPUT/DATA/PREV, top-level keys, or sys.stdin. Other languages: stdout -> stdin.`

const CONNECT = `CONNECT  (vexelboard_connect_elements | vexel.mjs connect --from A --to B)
{ sourceId, targetId, sourcePort?(top|right|bottom|left), targetPort?, routing?(orthogonal|curved|straight), color?, label?, animated? }
Code->Code pipes output; Code->Graph/3D live-updates the visual whenever the upstream card runs.`

const OTHER = `OTHER: vexelboard_add_note {title?,content(Markdown),color?} | vexelboard_add_equation {title?,latex} | vexelboard_delete_elements {elementIds[]} | vexelboard_capture_selection (returns PNG file path + selectedIds + selectionBounds) | vexelboard_search_knowledge {query,limit?}`

export const HELP_TOPICS: Record<string, string> = {
  graph: GRAPH,
  diagram: DIAGRAM,
  scene: SCENE,
  '3d': THREE_D,
  code: CODE,
  pipeline: PIPELINE,
  connect: CONNECT,
  other: OTHER
}

export function getCompanionHelp(topic?: string): { ok: boolean; topic: string; help: string; topics: string[] } {
  const topics = Object.keys(HELP_TOPICS)
  const key = String(topic ?? 'all').trim().toLowerCase()
  if (key === '' || key === 'all') {
    return { ok: true, topic: 'all', topics, help: [COMPANION_INSTRUCTIONS, ...Object.values(HELP_TOPICS)].join('\n\n') }
  }
  const aliases: Record<string, string> = {
    chart: 'graph',
    plot: 'graph',
    graphs: 'graph',
    flowchart: 'diagram',
    architecture: 'diagram',
    vector: 'scene',
    spatial: 'scene',
    '3d_scene': '3d',
    three: '3d',
    pipelines: 'pipeline',
    connector: 'connect',
    note: 'other',
    equation: 'other'
  }
  const resolved = HELP_TOPICS[key] ? key : aliases[key]
  if (!resolved) {
    return { ok: false, topic: key, topics, help: `Unknown topic "${key}". Available: ${topics.join(', ')}, all.` }
  }
  return { ok: true, topic: resolved, topics, help: HELP_TOPICS[resolved] }
}
