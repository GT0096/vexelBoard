export type BoardShapeCategory =
  | 'basic'
  | 'flowchart'
  | 'ml'
  | 'architecture'
  | 'uml'
  | 'bpmn'
  | 'erd'
  | 'threeD'
  | 'symbols'
  | 'connectors'

export type BoardFontId = 'jakarta' | 'caveat' | 'grotesk' | 'mono' | 'serif'

export interface FirstPrinciplesPrimitiveEntry {
  id: string
  name: string
  category: 'spatial_scene' | 'graph' | 'symbolic' | 'code' | 'note'
  toolOrField: string
  capabilities: string[]
  tags: string[]
  exampleSnippet: string
}

export interface BoardShapeCatalogEntry {
  id: string
  name: string
  category: BoardShapeCategory
  tags: string[]
  defaultSize: [number, number]
  useCase: string
}

export interface BoardFontCatalogEntry {
  id: BoardFontId
  name: string
  style: string
  bestFor: string[]
  tags: string[]
}

export interface BoardColorPaletteEntry {
  id: string
  name: string
  domain: string
  nodeFill: string
  secondaryFill: string
  accentStroke: string
  noteCardFill: string
  tags: string[]
}

export interface PedagogicalApproachEntry {
  id: string
  name: string
  domains: string[]
  recommendedTools: string[]
  primitives: FirstPrinciplesPrimitiveEntry[]
  structureGuide: string
  recommendedFont: BoardFontId
  recommendedPaletteId: string
}

export const FIRST_PRINCIPLES_PRIMITIVES: FirstPrinciplesPrimitiveEntry[] = [
  {
    id: 'spatial_shape',
    name: 'Geometric & Concentric Primitives (SpatialShape)',
    category: 'spatial_scene',
    toolOrField: 'SpatialScene.elements[{ type: "shape" }]',
    capabilities: [
      'Arbitrary size and position (x,y,w,h or cx,cy,r / cx,cy,rx,ry for concentric atoms/cells/orbits)',
      'Translucent layering via fillOpacity (0..1) and custom hex fill/stroke colors',
      'Polygons (hexagon for benzene/aromatic rings, pentagon, octagon, triangle, star-5, cross)',
      '3D bodies (sphere3d, cube3d, cylinder3d, cone, pyramid) and rotated bonds/wedges (rotation)',
      'Open-sided containers (openSides) and marching/pulsing animations (animated, strokeStyle)'
    ],
    tags: [
      'atom', 'orbital', 'nucleus', 'electron', 'cell', 'molecule', 'ring', 'benzene',
      'hexagon', 'geometry', 'circle', 'sphere', 'vector', 'force', 'physics', 'biology', 'chemistry'
    ],
    exampleSnippet:
      '{"type":"shape","id":"shell1","kind":"circle","cx":500,"cy":500,"r":180,"fill":"transparent","stroke":"#38BDF8","strokeStyle":"dashed"}'
  },
  {
    id: 'spatial_svg_path',
    name: 'Arbitrary Parametric & Organic Vector Contours (SpatialPath)',
    category: 'spatial_scene',
    toolOrField: 'SpatialScene.elements[{ type: "svg_path" }]',
    capabilities: [
      'Compose any custom SVG Bezier path (d: "M ... C ... Q ... Z") or multi-layer paths[] inside 0..1000 canvas',
      'Supports custom viewBox, translucent fillOpacity, strokeStyle, rotation, and marching-dash animations',
      'Ideal for organic membranes, mitochondria, vesicles, fluid vessels, waveguides, crystal lattices, or botanical diagrams'
    ],
    tags: [
      'biology', 'organelle', 'membrane', 'chloroplast', 'mitochondria', 'dna', 'enzyme',
      'substrate', 'waveform', 'lens', 'crystal', 'organ', 'chemistry', 'curve', 'custom', 'organic'
    ],
    exampleSnippet:
      '{"type":"svg_path","id":"membrane","d":"M 150 500 C 200 220 800 220 850 500 C 800 780 200 780 150 500 Z","fill":"#DCFCE7","fillOpacity":0.35,"stroke":"#16A34A","strokeWidth":3}'
  },
  {
    id: 'spatial_curve_connector',
    name: 'Continuous Curves, Waves, Vectors & Reaction Arrows (SpatialConnector)',
    category: 'spatial_scene',
    toolOrField: 'SpatialScene.elements[{ type: "connector" }]',
    capabilities: [
      '2-point directional vectors/bonds, 3-point quadratic arcs, or 4+ point smooth Catmull-Rom splines (curved: true)',
      'Custom strokeWidth, solid/dashed/dotted lines, double/single arrowheads (arrowStart, arrowEnd)',
      'Synchronized traveling signal/energy pulses (animated: true, animationMode: "pulse"|"dash"|"both", pulseColor, flowStage)'
    ],
    tags: [
      'reaction', 'arrow', 'photon', 'wave', 'potential', 'energy', 'activation', 'curve',
      'graph', 'plot', 'trajectory', 'force', 'electron', 'signal', 'oscillation', 'price', 'physics', 'chemistry'
    ],
    exampleSnippet:
      '{"type":"connector","id":"ea_curve","points":[[120,720],[320,700],[500,240],[680,620],[880,760]],"curved":true,"arrowEnd":true,"stroke":"#EA580C","strokeWidth":3}'
  },
  {
    id: 'spatial_cell_strip',
    name: 'Sequential & Gapped Compartment Chains (SpatialCellStrip)',
    category: 'spatial_scene',
    toolOrField: 'SpatialScene.elements[{ type: "cell_strip" }]',
    capabilities: [
      'Contiguous cell grids (openEnds stacks/queues/matrices/histograms) OR spaced node sequences via explicit cellGap + connectorArrows ("forward"|"bidirectional"|"circular")',
      'Ideal for nucleotide/codon sequences, peptide chains, electron orbital boxes, metabolic cascades, Markov chains, and linked structures'
    ],
    tags: [
      'sequence', 'dna', 'rna', 'codon', 'protein', 'chain', 'polymer', 'stack', 'queue',
      'array', 'matrix', 'table', 'linked-list', 'orbital', 'spin', 'biology', 'chemistry', 'algorithm'
    ],
    exampleSnippet:
      '{"type":"cell_strip","id":"mrna","orientation":"horizontal","x":120,"y":420,"w":760,"h":96,"cells":["AUG","GCU","UUC","UAG"],"cellGap":34,"connectorArrows":"forward","cellFill":"#FEF3C7"}'
  },
  {
    id: 'spatial_text',
    name: 'Collision-Free Annotations & Labels (SpatialText)',
    category: 'spatial_scene',
    toolOrField: 'SpatialScene.elements[{ type: "text" }]',
    capabilities: [
      'Frameless canvas-immersed labels anchored by x, y, fontSize, bold, align, and color',
      'Automatic obstacle collision resolution keeps equations, stoichiometric coefficients, charges, and axis ticks crisp'
    ],
    tags: ['label', 'annotation', 'axis', 'caption', 'charge', 'units', 'text', 'title'],
    exampleSnippet:
      '{"type":"text","id":"ea_lbl","x":500,"y":185,"text":"Activation Energy E_a","fontSize":18,"bold":true,"align":"center","color":"#C2410C"}'
  },
  {
    id: 'topological_graph',
    name: 'Connected System & Cycle Topologies (Interactive Diagram)',
    category: 'graph',
    toolOrField: 'create_interactive_diagram / diagramNodes + diagramEdges',
    capabilities: [
      'Auto-laid-out multi-stage graphs built from any registered Vexelboard shape ID with orthogonal bound connectors',
      'Supports LR/TB flow directions, edge styles, and stage-synchronized traveling pulse propagation (animated: true)'
    ],
    tags: [
      'network', 'cycle', 'pathway', 'krebs', 'architecture', 'pipeline', 'fsm', 'uml',
      'erd', 'bpmn', 'flowchart', 'transformer', 'microservice', 'workflow', 'systems'
    ],
    exampleSnippet:
      '{"title":"Cycle","direction":"LR","animated":true,"nodes":[{"id":"1","label":"State A"}],"edges":[{"source":"1","target":"2","label":"step"}]}'
  },
  {
    id: 'symbolic_equation',
    name: 'Formal Symbolic, Chemical & Mathematical Notation (KaTeX)',
    category: 'symbolic',
    toolOrField: 'equations[] / add_equation',
    capabilities: [
      'Multi-line or stepped KaTeX expressions covering algebraic derivations, differential equations, quantum operators, nuclear/chemical balanced stoichiometry (e.g. \\ce or \\rightarrow), thermodynamics, and financial expectations'
    ],
    tags: [
      'equation', 'latex', 'katex', 'stoichiometry', 'reaction', 'equilibrium', 'quantum',
      'integral', 'derivative', 'theorem', 'proof', 'formula', 'math', 'physics', 'chemistry', 'finance'
    ],
    exampleSnippet:
      '6\\text{CO}_2 + 6\\text{H}_2\\text{O} + h\\nu \\longrightarrow \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2'
  },
  {
    id: 'executable_code',
    name: 'Runnable Computational Verification (Code Card)',
    category: 'code',
    toolOrField: 'create_or_patch_code / codeSnippet',
    capabilities: [
      'Interactive multi-tab executable Python/JS/TS blocks ONLY when algorithmic implementation or numerical simulation genuinely adds insight'
    ],
    tags: ['code', 'python', 'javascript', 'typescript', 'simulation', 'algorithm', 'implementation'],
    exampleSnippet: ''
  },
  {
    id: 'conceptual_note',
    name: 'Focused First-Principles Intuition & Boundary Notes',
    category: 'note',
    toolOrField: 'add_note_card / explanation',
    capabilities: [
      'Explains physical/chemical/biological causality, assumptions, conservation laws, and limiting conditions concisely in domain typography'
    ],
    tags: ['explanation', 'causality', 'intuition', 'summary', 'notes', 'mechanism'],
    exampleSnippet: ''
  }
]

export const BOARD_SHAPE_CATALOG: BoardShapeCatalogEntry[] = [
  // Basic & Geometry
  {
    id: 'rect',
    name: 'Sharp Rectangle / Memory Cell',
    category: 'basic',
    tags: ['box', 'cell', 'matrix', 'array', 'table', 'geometry', 'basic'],
    defaultSize: [168, 80],
    useCase: 'Matrix cells, array buckets, or crisp rectangular containers'
  },
  {
    id: 'rounded-rect',
    name: 'Rounded Rectangle / Step Block',
    category: 'basic',
    tags: ['process', 'step', 'node', 'stage', 'card', 'basic'],
    defaultSize: [174, 82],
    useCase: 'Standard process steps, blocks, or concept containers'
  },
  {
    id: 'circle',
    name: 'Circle / Vertex',
    category: 'basic',
    tags: ['state', 'graph', 'vertex', 'tree', 'orbit', 'venn', 'math', 'physics'],
    defaultSize: [118, 118],
    useCase: 'Graph vertices, finite states, particles, or Venn sets'
  },
  {
    id: 'ellipse',
    name: 'Ellipse / Oval',
    category: 'basic',
    tags: ['oval', 'start', 'end', 'orbit', 'set', 'math'],
    defaultSize: [150, 92],
    useCase: 'Elliptical orbits, sets, or terminal pills'
  },
  {
    id: 'diamond',
    name: 'Diamond / Condition Branch',
    category: 'basic',
    tags: ['decision', 'branch', 'if', 'condition', 'flowchart', 'gate'],
    defaultSize: [170, 112],
    useCase: 'Branching yes/no conditions or routing checks'
  },
  {
    id: 'triangle',
    name: 'Triangle / Geometry Polygon',
    category: 'basic',
    tags: ['trigonometry', 'wedge', 'incline', 'ramp', 'geometry', 'math', 'physics'],
    defaultSize: [130, 112],
    useCase: 'Inclined planes, trigonometry triangles, or delta elements'
  },
  {
    id: 'parallelogram',
    name: 'Parallelogram / Data I/O',
    category: 'basic',
    tags: ['input', 'output', 'tensor', 'vector', 'geometry', 'flowchart'],
    defaultSize: [174, 82],
    useCase: 'Data input/output or geometric transformation panels'
  },
  {
    id: 'pentagon',
    name: 'Pentagon / 5-Member Ring',
    category: 'basic',
    tags: ['polygon', 'five', 'ribose', 'cyclopentane', 'chemistry', 'biology', 'geometry'],
    defaultSize: [130, 124],
    useCase: 'Five-membered cyclic rings (furanose/ribose/cyclopentane) or geometric polygons'
  },
  {
    id: 'hexagon',
    name: 'Hexagon / 6-Member Ring / Prep Stage',
    category: 'basic',
    tags: ['microservice', 'prep', 'setup', 'polygon', 'chemistry', 'benzene', 'cyclohexane', 'biology'],
    defaultSize: [148, 108],
    useCase: 'Six-membered chemical rings (benzene, pyranose, glucose), lattice cells, or preparation blocks'
  },
  {
    id: 'octagon',
    name: 'Octagon / Halting Gate',
    category: 'basic',
    tags: ['stop', 'halt', 'gate', 'polygon'],
    defaultSize: [130, 130],
    useCase: 'Stop gates or safety checkpoints'
  },
  {
    id: 'star-5',
    name: '5-Point Star / Highlight / Catalyst',
    category: 'basic',
    tags: ['star', 'highlight', 'catalyst', 'excitation', 'photon', 'physics', 'chemistry'],
    defaultSize: [110, 110],
    useCase: 'Excited states, catalytic activation centers, or highlight markers'
  },
  {
    id: 'cross',
    name: 'Cross / Positive Ion / Junction',
    category: 'basic',
    tags: ['plus', 'ion', 'cation', 'proton', 'positive', 'chemistry', 'physics'],
    defaultSize: [96, 96],
    useCase: 'Positive ions, proton markers, or axis crosshairs'
  },
  {
    id: 'donut',
    name: 'Hollow Ring / Torus / Shell',
    category: 'basic',
    tags: ['ring', 'shell', 'torus', 'orbital', 'membrane', 'pore', 'atom', 'biology'],
    defaultSize: [130, 130],
    useCase: 'Hollow shells, ion channels/pores, orbits, or annular structures'
  },
  {
    id: 'wave',
    name: 'Sinusoidal Wave Band',
    category: 'basic',
    tags: ['wave', 'oscillation', 'frequency', 'photon', 'electromagnetic', 'physics', 'acoustics'],
    defaultSize: [160, 88],
    useCase: 'Waveforms, electromagnetic oscillations, or signal carriers'
  },
  {
    id: 'svg-path',
    name: 'Custom Vector Path (Parametric Bezier SVG)',
    category: 'basic',
    tags: ['svg', 'bezier', 'curve', 'organic', 'membrane', 'organelle', 'custom', 'biology', 'chemistry', 'physics'],
    defaultSize: [220, 160],
    useCase: 'Arbitrary custom vector paths, biological membranes, curves, potentials, and custom geometry'
  },

  // Flowchart
  {
    id: 'fc-process',
    name: 'Flowchart Process',
    category: 'flowchart',
    tags: ['action', 'compute', 'operation', 'flowchart'],
    defaultSize: [174, 82],
    useCase: 'Core computational step in an algorithm or workflow'
  },
  {
    id: 'fc-decision',
    name: 'Flowchart Decision',
    category: 'flowchart',
    tags: ['condition', 'branch', 'check', 'flowchart'],
    defaultSize: [170, 112],
    useCase: 'Boolean or multi-way decision diamond'
  },
  {
    id: 'fc-terminator',
    name: 'Flowchart Terminator (Start/End)',
    category: 'flowchart',
    tags: ['start', 'end', 'entry', 'exit', 'stadium', 'flowchart'],
    defaultSize: [164, 68],
    useCase: 'Entry or exit capsule'
  },
  {
    id: 'fc-data',
    name: 'Flowchart Data I/O',
    category: 'flowchart',
    tags: ['input', 'output', 'stream', 'flowchart'],
    defaultSize: [174, 82],
    useCase: 'User/stream input or output step'
  },
  {
    id: 'fc-document',
    name: 'Flowchart Document',
    category: 'flowchart',
    tags: ['file', 'paper', 'report', 'artifact', 'flowchart'],
    defaultSize: [168, 102],
    useCase: 'Generated file, log, or specification document'
  },
  {
    id: 'fc-database',
    name: 'Flowchart Database',
    category: 'flowchart',
    tags: ['db', 'storage', 'sql', 'table', 'flowchart'],
    defaultSize: [144, 116],
    useCase: 'Persistent storage node inside flowcharts'
  },
  {
    id: 'fc-predefined-process',
    name: 'Subroutine / Function Call',
    category: 'flowchart',
    tags: ['subroutine', 'function', 'module', 'flowchart'],
    defaultSize: [176, 86],
    useCase: 'Reusable subroutine or external library invocation'
  },
  {
    id: 'fc-manual-input',
    name: 'Manual Input Prompt',
    category: 'flowchart',
    tags: ['user-input', 'form', 'prompt', 'flowchart'],
    defaultSize: [168, 86],
    useCase: 'Manual operator entry or configuration step'
  },
  {
    id: 'fc-preparation',
    name: 'Preparation / Initialization',
    category: 'flowchart',
    tags: ['init', 'loop', 'setup', 'flowchart'],
    defaultSize: [168, 84],
    useCase: 'Loop initialization or parameter setup'
  },
  {
    id: 'fc-delay',
    name: 'Wait / Delay Block',
    category: 'flowchart',
    tags: ['sleep', 'timer', 'wait', 'latency', 'flowchart'],
    defaultSize: [154, 78],
    useCase: 'Latency buffer, debounce, or scheduled wait'
  },
  {
    id: 'fc-display',
    name: 'Display / Render Output',
    category: 'flowchart',
    tags: ['screen', 'ui', 'render', 'flowchart'],
    defaultSize: [168, 88],
    useCase: 'Visual display or monitoring dashboard output'
  },
  {
    id: 'fc-stored-data',
    name: 'Stored Data Buffer',
    category: 'flowchart',
    tags: ['buffer', 'cache', 'memory', 'flowchart'],
    defaultSize: [164, 86],
    useCase: 'In-memory buffer or sequential tape storage'
  },
  {
    id: 'fc-summing-junction',
    name: 'Summing / Merge Junction',
    category: 'flowchart',
    tags: ['combine', 'merge', 'sum', 'junction', 'flowchart'],
    defaultSize: [58, 58],
    useCase: 'Signal or control-flow convergence junction'
  },

  // Machine Learning & Neural Architectures
  {
    id: 'ml-neural-net',
    name: 'Multi-Layer Neural Network (MLP / FFN / Expert)',
    category: 'ml',
    tags: ['transformer', 'moe', 'mlp', 'ffn', 'expert', 'neural', 'deep-learning', 'ai', 'layer'],
    defaultSize: [204, 132],
    useCase: 'Animated feed-forward layers, MoE experts, or hidden dense blocks'
  },
  {
    id: 'ml-token-vector',
    name: 'Token Embedding Vector',
    category: 'ml',
    tags: ['token', 'embedding', 'vector', 'transformer', 'attention', 'llm', 'sequence'],
    defaultSize: [96, 38],
    useCase: 'Representing token embeddings or feature vector slices'
  },
  {
    id: 'ml-adder',
    name: 'Residual Adder Junction',
    category: 'ml',
    tags: ['residual', 'skip-connection', 'add-norm', 'transformer', 'summation', 'signal'],
    defaultSize: [46, 46],
    useCase: 'Residual skip-connection merge points'
  },

  // System Design & Network Architecture
  {
    id: 'cylinder',
    name: 'Database / Storage Cylinder',
    category: 'architecture',
    tags: ['database', 'sql', 'nosql', 'cache', 'redis', 'storage', 'system'],
    defaultSize: [144, 116],
    useCase: 'Databases, caches, object stores, or feature stores'
  },
  {
    id: 'cloud',
    name: 'Cloud / External Network',
    category: 'architecture',
    tags: ['cloud', 'aws', 'gcp', 'internet', 'gateway', 'cdn', 'system'],
    defaultSize: [184, 110],
    useCase: 'Cloud platforms, CDNs, API gateways, or external services'
  },
  {
    id: 'server',
    name: 'Compute Server / Node',
    category: 'architecture',
    tags: ['server', 'backend', 'worker', 'host', 'vm', 'cluster', 'system'],
    defaultSize: [136, 118],
    useCase: 'Application servers, inference workers, or cluster hosts'
  },
  {
    id: 'queue',
    name: 'Message Queue / Stream',
    category: 'architecture',
    tags: ['kafka', 'rabbitmq', 'sqs', 'fifo', 'queue', 'stream', 'broker'],
    defaultSize: [170, 82],
    useCase: 'Async message queues, Kafka topics, or event buffers'
  },
  {
    id: 'actor',
    name: 'User / Actor',
    category: 'architecture',
    tags: ['user', 'client', 'trader', 'customer', 'person', 'role'],
    defaultSize: [96, 118],
    useCase: 'Human actors, end clients, or external consumers'
  },
  {
    id: 'component',
    name: 'Modular Software Component',
    category: 'architecture',
    tags: ['service', 'module', 'package', 'sdk', 'component', 'uml'],
    defaultSize: [174, 90],
    useCase: 'Modular services, plugins, or SDK boundaries'
  },
  {
    id: 'net-server',
    name: 'Network Rack Server',
    category: 'architecture',
    tags: ['datacenter', 'server', 'hardware', 'network'],
    defaultSize: [120, 120],
    useCase: 'Dedicated hardware or bare-metal servers'
  },
  {
    id: 'net-router',
    name: 'Network Router',
    category: 'architecture',
    tags: ['router', 'routing', 'packet', 'network', 'transformer', 'moe'],
    defaultSize: [110, 110],
    useCase: 'Packet routing, gating routers, or traffic steering'
  },
  {
    id: 'net-switch',
    name: 'Network Switch',
    category: 'architecture',
    tags: ['switch', 'lan', 'fabric', 'network'],
    defaultSize: [120, 90],
    useCase: 'L2/L3 network switching or crossbar fabrics'
  },
  {
    id: 'net-firewall',
    name: 'Security Firewall',
    category: 'architecture',
    tags: ['firewall', 'waf', 'security', 'auth', 'shield', 'network'],
    defaultSize: [110, 110],
    useCase: 'Security perimeters, WAF rules, and guardrails'
  },
  {
    id: 'net-load-balancer',
    name: 'Load Balancer',
    category: 'architecture',
    tags: ['lb', 'nginx', 'envoy', 'proxy', 'traffic', 'network'],
    defaultSize: [120, 100],
    useCase: 'Traffic distribution across replicas'
  },
  {
    id: 'net-globe',
    name: 'Global Region / DNS / CDN',
    category: 'architecture',
    tags: ['dns', 'globe', 'world', 'edge', 'cdn', 'network'],
    defaultSize: [110, 110],
    useCase: 'Global edge locations, DNS, or public internet'
  },
  {
    id: 'net-container',
    name: 'Container / Pod',
    category: 'architecture',
    tags: ['docker', 'kubernetes', 'k8s', 'pod', 'container', 'microservice'],
    defaultSize: [140, 100],
    useCase: 'Docker containers, Kubernetes pods, or isolated sandboxes'
  },
  {
    id: 'net-function',
    name: 'Serverless Function / Lambda',
    category: 'architecture',
    tags: ['serverless', 'lambda', 'edge-function', 'compute'],
    defaultSize: [120, 100],
    useCase: 'Event-driven serverless handlers'
  },

  // UML, ER, BPMN & 3D
  {
    id: 'uml-class',
    name: 'UML Class Box',
    category: 'uml',
    tags: ['oop', 'class', 'struct', 'object', 'uml'],
    defaultSize: [170, 120],
    useCase: 'Object-oriented classes with fields and methods'
  },
  {
    id: 'uml-interface',
    name: 'UML Interface',
    category: 'uml',
    tags: ['interface', 'contract', 'trait', 'uml'],
    defaultSize: [170, 110],
    useCase: 'Abstract interfaces and API contracts'
  },
  {
    id: 'uml-package',
    name: 'UML Package / Namespace',
    category: 'uml',
    tags: ['package', 'folder', 'namespace', 'module', 'uml'],
    defaultSize: [200, 130],
    useCase: 'Grouping modules or domain boundaries'
  },
  {
    id: 'uml-lifeline',
    name: 'Sequence Lifeline',
    category: 'uml',
    tags: ['sequence', 'protocol', 'timeline', 'uml'],
    defaultSize: [120, 180],
    useCase: 'Protocol or sequence diagram participants'
  },
  {
    id: 'uml-state',
    name: 'UML State Node',
    category: 'uml',
    tags: ['fsm', 'state-machine', 'lifecycle', 'uml'],
    defaultSize: [160, 90],
    useCase: 'State machine transitions and lifecycle steps'
  },
  {
    id: 'er-entity',
    name: 'ER Entity',
    category: 'erd',
    tags: ['schema', 'entity', 'table', 'erd', 'sql'],
    defaultSize: [160, 88],
    useCase: 'Domain entities in database schemas'
  },
  {
    id: 'er-table',
    name: 'Database Schema Table',
    category: 'erd',
    tags: ['table', 'columns', 'rows', 'sql', 'erd'],
    defaultSize: [180, 120],
    useCase: 'Relational tables with columns and keys'
  },
  {
    id: 'er-relationship',
    name: 'ER Relationship Diamond',
    category: 'erd',
    tags: ['relation', 'join', 'cardinality', 'erd'],
    defaultSize: [140, 96],
    useCase: '1:1, 1:N, M:N relationship links'
  },
  {
    id: 'bpmn-task',
    name: 'BPMN Task',
    category: 'bpmn',
    tags: ['business', 'workflow', 'task', 'bpmn'],
    defaultSize: [170, 88],
    useCase: 'Business workflow activity steps'
  },
  {
    id: 'bpmn-gateway-exclusive',
    name: 'BPMN Exclusive Gateway',
    category: 'bpmn',
    tags: ['xor', 'branch', 'gateway', 'bpmn'],
    defaultSize: [96, 96],
    useCase: 'Exclusive workflow branching'
  },
  {
    id: 'cube3d',
    name: '3D Isometric Tensor / Block',
    category: 'threeD',
    tags: ['tensor', 'matrix', '3d', 'cube', 'volume', 'physics', 'block'],
    defaultSize: [130, 130],
    useCase: '3D tensors, solid physics blocks, or volumetric data'
  },
  {
    id: 'sphere3d',
    name: '3D Shaded Sphere / Particle',
    category: 'threeD',
    tags: ['planet', 'mass', 'charge', 'atom', 'electron', 'physics', '3d'],
    defaultSize: [110, 110],
    useCase: 'Particles, planets, masses, or point charges in physics'
  },
  {
    id: 'callout-rect',
    name: 'Annotation Callout Box',
    category: 'symbols',
    tags: ['callout', 'hint', 'annotation', 'insight', 'trading', 'proof'],
    defaultSize: [180, 96],
    useCase: 'Explaining anomalies, entry signals, or key proof steps'
  },
  {
    id: 'lightbulb',
    name: 'Key Insight Icon',
    category: 'symbols',
    tags: ['intuition', 'idea', 'tip', 'insight'],
    defaultSize: [72, 72],
    useCase: 'Highlighting the core intuition or trick'
  },
  {
    id: 'warning-triangle',
    name: 'Pitfall / Risk Alert',
    category: 'symbols',
    tags: ['warning', 'risk', 'drawdown', 'stop-loss', 'edge-case', 'pitfall'],
    defaultSize: [82, 74],
    useCase: 'Calling out common pitfalls, edge cases, or stop-loss risk levels'
  },
  {
    id: 'gear',
    name: 'Mechanism / Engine Icon',
    category: 'symbols',
    tags: ['engine', 'mechanics', 'process', 'torque', 'physics'],
    defaultSize: [80, 80],
    useCase: 'Rotational mechanics or background processing engines'
  },
  {
    id: 'cone',
    name: '3D Cone / Field Envelope',
    category: 'threeD',
    tags: ['cone', 'optics', 'beam', 'light-cone', '3d', 'physics', 'geometry'],
    defaultSize: [110, 130],
    useCase: 'Light cones, radiation beams, funnels, or 3D conic sections'
  },
  {
    id: 'pyramid',
    name: '3D Pyramid / Tetrahedral Geometry',
    category: 'threeD',
    tags: ['tetrahedron', 'pyramid', '3d', 'molecular', 'chemistry', 'hierarchy'],
    defaultSize: [120, 120],
    useCase: 'Tetrahedral molecular geometry or 3D trophic/energy pyramids'
  },
  {
    id: 'brace-left',
    name: 'Left Grouping Brace',
    category: 'symbols',
    tags: ['brace', 'group', 'annotation', 'bracket', 'math', 'chemistry'],
    defaultSize: [48, 140],
    useCase: 'Grouping equations, electron shells, or reaction subsets cleanly'
  },
  {
    id: 'brace-right',
    name: 'Right Grouping Brace',
    category: 'symbols',
    tags: ['brace', 'group', 'annotation', 'bracket', 'math', 'chemistry'],
    defaultSize: [48, 140],
    useCase: 'Grouping products, outputs, or multi-step annotations cleanly'
  },
  {
    id: 'anim-line-arrow',
    name: 'Animated Signal Flow Arrow',
    category: 'connectors',
    tags: ['animated', 'signal', 'pulse', 'wave', 'flow', 'connector', 'vector'],
    defaultSize: [160, 48],
    useCase: 'Traveling signal pulses for reactions, pathways, pipelines, or force vectors'
  },
  {
    id: 'anim-line-wave',
    name: 'Animated Electromagnetic / Photon Wave Arrow',
    category: 'connectors',
    tags: ['wave', 'photon', 'radiation', 'oscillation', 'physics', 'chemistry', 'animated', 'em'],
    defaultSize: [160, 56],
    useCase: 'Emitted photons, thermal waves, acoustic propagation, or oscillatory transfer'
  },
  {
    id: 'anim-line-loop',
    name: 'Animated Cyclic / Catalytic Loop',
    category: 'connectors',
    tags: ['cycle', 'catalyst', 'feedback', 'krebs', 'loop', 'biology', 'chemistry', 'animated'],
    defaultSize: [150, 84],
    useCase: 'Catalytic regeneration cycles, metabolic loops, or feedback pathways'
  },
  {
    id: 'anim-line-fork',
    name: 'Animated Bifurcation / Reaction Fork',
    category: 'connectors',
    tags: ['fork', 'branch', 'split', 'decay', 'fission', 'biology', 'chemistry', 'physics', 'animated'],
    defaultSize: [150, 100],
    useCase: 'Mitosis/branching pathways, parallel reaction products, or signal splitting'
  },
  {
    id: 'anim-line-elbow',
    name: 'Animated Orthogonal Step Connector',
    category: 'connectors',
    tags: ['residual', 'bypass', 'orthogonal', 'step', 'animated', 'connector'],
    defaultSize: [150, 90],
    useCase: 'Skip connections and clean 90-degree routing paths'
  }
]

export const BOARD_FONT_CATALOG: BoardFontCatalogEntry[] = [
  {
    id: 'serif',
    name: 'Georgia Editorial Serif',
    style: 'Classic scientific, chemical, and mathematical typography',
    bestFor: ['Derivations', 'Chemical stoichiometry', 'Atomic/quantum theory', 'Formal theorems'],
    tags: ['math', 'calculus', 'algebra', 'proof', 'physics', 'atom', 'chemistry', 'quantum', 'theorem', 'academic']
  },
  {
    id: 'mono',
    name: 'JetBrains Mono',
    style: 'Fixed-width sequential, genetic & computational typography',
    bestFor: ['Genetic/codon sequences', 'Memory layouts', 'Algorithms', 'Reaction state indices'],
    tags: ['code', 'algorithm', 'stack', 'queue', 'linked-list', 'memory', 'sequence', 'codon', 'dna', 'rna', 'cs', 'programming']
  },
  {
    id: 'grotesk',
    name: 'Space Grotesk',
    style: 'Sharp geometric engineering, spectroscopy & analytics sans',
    bestFor: ['System topology', 'Quantitative plots', 'Energy diagrams', 'Signal & market metrics'],
    tags: ['architecture', 'trading', 'finance', 'chart', 'plot', 'graph', 'wave', 'ml', 'neural', 'ai', 'system']
  },
  {
    id: 'caveat',
    name: 'Caveat Handwritten Ink',
    style: 'Natural whiteboard instructor handwriting',
    bestFor: ['Intuitive callouts', 'Brainstorming', 'Student annotations', 'Visual sketching'],
    tags: ['brainstorm', 'intuition', 'sketch', 'handwritten', 'callout', 'mindmap']
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    style: 'Crisp high-legibility modern scientific & conceptual sans-serif',
    bestFor: ['Biological processes', 'Conceptual models', 'Multi-disciplinary mechanisms'],
    tags: ['general', 'concept', 'biology', 'cell', 'organelle', 'process', 'overview', 'workflow', 'default']
  }
]

export const BOARD_COLOR_PALETTES: BoardColorPaletteEntry[] = [
  {
    id: 'semantic-structure',
    name: 'Structural Contrast (Amber / Violet)',
    domain: 'Core geometric bodies, proofs, and contrasting regions (arbitrary hex & fillOpacity supported on any element)',
    nodeFill: '#FEF9C3',
    secondaryFill: '#EDE9FE',
    accentStroke: '#6D28D9',
    noteCardFill: '#FFFBEB',
    tags: ['structure', 'proof', 'derivation', 'math', 'calculus', 'algebra', 'geometry', 'theorem', 'logic', 'concept']
  },
  {
    id: 'semantic-energy-reaction',
    name: 'Reaction & Activation Warmth (Amber / Coral)',
    domain: 'Chemical reactions, catalysis, activation barriers, bonding, and exothermic states',
    nodeFill: '#FFEDD5',
    secondaryFill: '#FEF3C7',
    accentStroke: '#EA580C',
    noteCardFill: '#FFF7ED',
    tags: ['chemistry', 'reaction', 'catalyst', 'activation', 'enthalpy', 'bond', 'acid', 'base', 'redox', 'molecule', 'ring']
  },
  {
    id: 'semantic-organic-bio',
    name: 'Cellular & Organic Palette (Mint / Teal)',
    domain: 'Biological membranes, organelles, metabolic cycles, and living processes',
    nodeFill: '#DCFCE7',
    secondaryFill: '#CCFBF1',
    accentStroke: '#15803D',
    noteCardFill: '#F0FDF4',
    tags: ['biology', 'cell', 'organelle', 'membrane', 'chloroplast', 'mitochondria', 'dna', 'rna', 'enzyme', 'photosynthesis', 'respiration', 'organic']
  },
  {
    id: 'semantic-quantum-wave',
    name: 'Field, Orbital & Wave Palette (Sky / Indigo)',
    domain: 'Atomic orbitals, photon waves, particle fields, mechanics, and optics',
    nodeFill: '#E0F2FE',
    secondaryFill: '#F3E8FF',
    accentStroke: '#0284C7',
    noteCardFill: '#F0F9FF',
    tags: ['atom', 'atomic', 'orbital', 'bohr', 'electron', 'photon', 'quantum', 'physics', 'wave', 'electromagnetic', 'force', 'mechanics', 'optics']
  },
  {
    id: 'semantic-quantitative',
    name: 'Quantitative Equilibrium Palette (Emerald / Rose)',
    domain: 'Supply/demand equilibria, price trends, statistical distributions, and regime thresholds',
    nodeFill: '#DCFCE7',
    secondaryFill: '#FEE2E2',
    accentStroke: '#059669',
    noteCardFill: '#F8FAFC',
    tags: ['chart', 'plot', 'graph', 'trading', 'finance', 'options', 'economics', 'supply', 'demand', 'statistics', 'regression']
  },
  {
    id: 'semantic-systems',
    name: 'Systems & Computation Palette (Cobalt / Slate)',
    domain: 'Computational states, architectures, neural graphs, and data structures',
    nodeFill: '#DBEAFE',
    secondaryFill: '#F1F5F9',
    accentStroke: '#2563EB',
    noteCardFill: '#F8FAFC',
    tags: ['system', 'architecture', 'transformer', 'moe', 'neural', 'algorithm', 'data-structure', 'code', 'network', 'microservice']
  }
]

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
}

function scoreMatch(tokens: string[], haystackFields: string[]): number {
  if (tokens.length === 0) return 1
  const joined = haystackFields.join(' ').toLowerCase()
  let score = 0
  for (const tok of tokens) {
    if (joined === tok) score += 6
    else if (joined.includes(tok)) score += 3
    else if (tok.length >= 4 && joined.includes(tok.slice(0, 4))) {
      score += 1
    }
  }
  return score
}

/**
 * Generates a generalized, domain-agnostic first-principles decomposition strategy for any topic
 * by dynamically matching composable board primitives, fonts, and semantic visual tokens.
 */
export function inferPedagogicalApproach(topicOrQuery: string): PedagogicalApproachEntry {
  const tokens = tokenize(topicOrQuery || '')

  const rankedPrimitives = FIRST_PRINCIPLES_PRIMITIVES.map((p) => ({
    entry: p,
    score:
      scoreMatch(tokens, [p.id, p.name, p.category, ...p.capabilities, ...p.tags]) +
      (p.category === 'spatial_scene' || p.category === 'symbolic' ? 1 : 0)
  }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry)

  const topFont = [...BOARD_FONT_CATALOG]
    .map((f) => ({
      entry: f,
      score:
        scoreMatch(tokens, [f.id, f.name, f.style, ...f.bestFor, ...f.tags]) +
        (f.id === 'jakarta' ? 1 : 0)
    }))
    .sort((a, b) => b.score - a.score)[0].entry

  const topPalette = [...BOARD_COLOR_PALETTES]
    .map((p) => ({
      entry: p,
      score: scoreMatch(tokens, [p.id, p.name, p.domain, ...p.tags])
    }))
    .sort((a, b) => b.score - a.score)[0].entry

  return {
    id: 'first_principles_synthesis',
    name: 'First-Principles Structural & Causal Synthesis',
    domains: ['any-domain', 'natural-sciences', 'mathematics', 'engineering', 'economics', 'computing'],
    recommendedTools: [
      'search_board_assets',
      'create_vector_diagram',
      'add_equation',
      'add_note_card',
      'create_interactive_diagram',
      'create_or_patch_code'
    ],
    primitives: rankedPrimitives.slice(0, 6),
    structureGuide:
      'Build from FIRST PRINCIPLES without rigid subject presets: (1) decompose the phenomenon into its irreducible constituent entities, forces/reactions, or state variables; (2) compose accurate custom visuals in `SpatialScene` using `shape` (with `cx,cy,r`, `fillOpacity`, `rotation`, polygons), arbitrary Bezier `svg_path` (`d`), smooth multi-point `curved: true` + `animated: true` waves/profiles, and contiguous or `cellGap` `cell_strip` sequences—or use `create_interactive_diagram` for multi-node cyclic/system graphs; (3) express governing chemical/physical/mathematical laws cleanly in LaTeX `equations`; (4) include only the components genuinely needed (omit unused boilerplate flowcharts or code cards).',
    recommendedFont: topFont.id,
    recommendedPaletteId: topPalette.id
  }
}

/**
 * Searches Vexelboard's composable primitives, registered shapes, fonts, and semantic palettes
 * so AI workflows synthesize any topic from first principles rather than hardcoding static lists in prompts.
 */
export function searchBoardAssets(args: {
  query?: string
  category?: string
  assetType?: 'shapes' | 'fonts' | 'colors' | 'primitives' | 'approaches' | 'all'
  limit?: number
}): {
  recommendedApproach: PedagogicalApproachEntry
  primitives: FirstPrinciplesPrimitiveEntry[]
  shapes: BoardShapeCatalogEntry[]
  fonts: BoardFontCatalogEntry[]
  colorPalettes: BoardColorPaletteEntry[]
  approaches: PedagogicalApproachEntry[]
} {
  const query = (args.query ?? '').trim()
  const tokens = tokenize(query)
  const assetType = args.assetType ?? 'all'
  const limit = Math.max(1, Math.min(30, args.limit ?? 14))
  const recommendedApproach = inferPedagogicalApproach(query)

  let primitives: FirstPrinciplesPrimitiveEntry[] = []
  if (assetType === 'all' || assetType === 'primitives') {
    primitives = FIRST_PRINCIPLES_PRIMITIVES.map((p) => ({
      entry: p,
      score: scoreMatch(tokens, [p.id, p.name, p.category, ...p.capabilities, ...p.tags])
    }))
      .sort((a, b) => b.score - a.score)
      .slice(0, assetType === 'primitives' ? limit : 6)
      .map((s) => s.entry)
  }

  let shapes: BoardShapeCatalogEntry[] = []
  if (assetType === 'all' || assetType === 'shapes') {
    const catFilter = args.category?.trim().toLowerCase()
    const pool = catFilter
      ? BOARD_SHAPE_CATALOG.filter((s) => s.category.toLowerCase() === catFilter)
      : BOARD_SHAPE_CATALOG
    const scored = pool.map((entry) => ({
      entry,
      score: scoreMatch(tokens, [
        entry.id,
        entry.name,
        entry.category,
        entry.useCase,
        ...entry.tags
      ])
    }))
    scored.sort((a, b) => b.score - a.score)
    shapes = scored.slice(0, limit).map((s) => s.entry)
  }

  let fonts: BoardFontCatalogEntry[] = []
  if (assetType === 'all' || assetType === 'fonts') {
    const scoredFonts = BOARD_FONT_CATALOG.map((f) => ({
      entry: f,
      score:
        scoreMatch(tokens, [f.id, f.name, f.style, ...f.bestFor, ...f.tags]) +
        (f.id === recommendedApproach.recommendedFont ? 3 : 0)
    }))
    scoredFonts.sort((a, b) => b.score - a.score)
    fonts = scoredFonts.slice(0, assetType === 'fonts' ? limit : 3).map((s) => s.entry)
  }

  let colorPalettes: BoardColorPaletteEntry[] = []
  if (assetType === 'all' || assetType === 'colors') {
    const scoredPalettes = BOARD_COLOR_PALETTES.map((p) => ({
      entry: p,
      score:
        scoreMatch(tokens, [p.id, p.name, p.domain, ...p.tags]) +
        (p.id === recommendedApproach.recommendedPaletteId ? 3 : 0)
    }))
    scoredPalettes.sort((a, b) => b.score - a.score)
    colorPalettes = scoredPalettes
      .slice(0, assetType === 'colors' ? limit : 3)
      .map((s) => s.entry)
  }

  const approaches: PedagogicalApproachEntry[] = [recommendedApproach]

  return {
    recommendedApproach,
    primitives,
    shapes,
    fonts,
    colorPalettes,
    approaches
  }
}

/**
 * Produces a compact, topic-relevant catalog of composable primitives, shapes, fonts, and semantic tokens
 * for single-shot router completions.
 */
export function formatDiscoveredAssetsForPrompt(query: string, limit = 12): string {
  const discovered = searchBoardAssets({ query, assetType: 'all', limit })
  const primitiveLines = discovered.primitives
    .map((p) => `${p.id} (${p.toolOrField}): ${p.capabilities[0]}`)
    .join('; ')
  const shapeLines = discovered.shapes
    .map((s) => `${s.id} (${s.name}: ${s.useCase})`)
    .join('; ')
  const fontLines = discovered.fonts
    .map((f) => `${f.id} (${f.style})`)
    .join('; ')
  const topPalette = discovered.colorPalettes[0]
  const paletteLine = topPalette
    ? `${topPalette.name} (nodeFill: ${topPalette.nodeFill}, secondaryFill: ${topPalette.secondaryFill}, accentStroke: ${topPalette.accentStroke} — or use any custom hex + fillOpacity)`
    : 'any semantic hex + fillOpacity (0..1)'

  return [
    `[DISCOVERED FIRST-PRINCIPLES BOARD PRIMITIVES & ASSETS]`,
    `- Synthesis Approach: ${discovered.recommendedApproach.name}`,
    `- Guidance: ${discovered.recommendedApproach.structureGuide}`,
    `- Composable Primitives: ${primitiveLines}`,
    `- Matching Font Options: ${fontLines}`,
    `- Semantic Color Suggestions: ${paletteLine}`,
    `- Matching Shape IDs: ${shapeLines}`
  ].join('\n')
}
