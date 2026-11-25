import rawLibrary from './shapeLibrary.json'

export type ShapePathRole = 'fill' | 'none' | 'shade' | 'light' | 'solid'
export type ShapeDashKind = 'dash' | 'dot' | 'dashdot'

export interface ShapePathSpec {
  d: string
  fill: ShapePathRole
  rule?: 'evenodd' | 'nonzero'
  dash?: ShapeDashKind
  stroke?: 'none' | string
  sw?: number
}

export interface LibraryShapeDef {
  id: string
  name: string
  category: string
  sources: ('essentials' | 'standard')[]
  size: [number, number]
  paths: ShapePathSpec[]
  text?: [number, number, number, number]
  defaultFill?: string
  defaultLabel?: string
  aliases: string[]
  tags: string[]
}

export interface ShapeCategoryDef {
  id: string
  name: string
  description: string
  count: number
}

export interface ShapeLibraryFile {
  $schema?: string
  name: string
  description: string
  version: number
  viewBox: string
  generatedBy: string
  count: number
  categories: ShapeCategoryDef[]
  shapes: LibraryShapeDef[]
}

const CATEGORY_DESCRIPTION_OVERRIDES: Record<string, string> = {
  basic: 'Basic geometric shapes and containers',
  polygons: 'Regular polygons and star variants',
  arrows: 'Directional block arrows and indicators',
  lines: 'Connector lines, arrows, and curves',
  flowchart: 'Full ANSI / ISO flowchart shapes',
  threeD: 'Cube, cylinder, cone, pyramid, and sphere shapes',
  mockup: 'UI controls and device wireframe frames'
}

function sanitizeDisplayText(text: string): string {
  return text.replace(/\s{2,}/g, ' ').trim()
}

export const ANIMATED_LINE_SHAPES: LibraryShapeDef[] = [
  {
    id: 'anim-line-flow',
    name: 'Flowing Line',
    category: 'lines',
    sources: [],
    size: [160, 44],
    paths: [{ d: 'M 6 50 L 94 50', fill: 'none', dash: 'dash' }],
    defaultLabel: '',
    aliases: ['flowing line', 'animated line'],
    tags: ['line', 'connector', 'animated', 'flow', 'dashed']
  },
  {
    id: 'anim-line-arrow',
    name: 'Animated Flow Arrow',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 6 50 L 90 50', fill: 'none', dash: 'dash' },
      { d: 'M 74 34 L 92 50 L 74 66', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated arrow', 'flow arrow'],
    tags: ['line', 'arrow', 'connector', 'animated', 'flow']
  },
  {
    id: 'anim-line-double-arrow',
    name: 'Bidirectional Flow Line',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 10 50 L 90 50', fill: 'none', dash: 'dash' },
      { d: 'M 26 34 L 8 50 L 26 66', fill: 'none' },
      { d: 'M 74 34 L 92 50 L 74 66', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['bidirectional flow', 'double arrow line'],
    tags: ['line', 'arrow', 'bidirectional', 'animated', 'connector']
  },
  {
    id: 'anim-line-dotted',
    name: 'Dotted Pulse Line',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 6 50 L 92 50', fill: 'none', dash: 'dot' },
      { d: 'M 76 36 L 92 50 L 76 64', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['dotted pulse', 'animated dotted line'],
    tags: ['line', 'dotted', 'pulse', 'animated', 'connector']
  },
  {
    id: 'anim-line-elbow',
    name: 'Animated Elbow Connector',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 80 L 50 80 L 50 20 L 92 20', fill: 'none', dash: 'dash' },
      { d: 'M 76 8 L 92 20 L 76 32', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated elbow', 'step up connector'],
    tags: ['line', 'elbow', 'step', 'orthogonal', 'animated', 'connector']
  },
  {
    id: 'anim-line-step-down',
    name: 'Animated Step-Down Line',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 20 L 50 20 L 50 80 L 92 80', fill: 'none', dash: 'dash' },
      { d: 'M 76 68 L 92 80 L 76 92', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['step down line', 'orthogonal connector'],
    tags: ['line', 'step', 'elbow', 'animated', 'connector']
  },
  {
    id: 'anim-line-curve',
    name: 'Animated S-Curve Connector',
    category: 'lines',
    sources: [],
    size: [150, 90],
    paths: [
      { d: 'M 8 80 C 50 80 50 20 92 20', fill: 'none', dash: 'dash' },
      { d: 'M 76 8 L 92 20 L 76 32', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['animated curve', 'bezier connector'],
    tags: ['line', 'curve', 'bezier', 'animated', 'connector']
  },
  {
    id: 'anim-line-circuit',
    name: 'Circuit Pulse Bus',
    category: 'lines',
    sources: [],
    size: [160, 48],
    paths: [
      { d: 'M 14 50 L 86 50', fill: 'none', dash: 'dashdot' },
      { d: 'M 8 50 A 3 3 0 1 0 14 50 A 3 3 0 1 0 8 50', fill: 'solid' },
      { d: 'M 86 50 A 3 3 0 1 0 92 50 A 3 3 0 1 0 86 50', fill: 'solid' }
    ],
    defaultLabel: '',
    aliases: ['circuit bus', 'node link', 'pulse bus'],
    tags: ['line', 'circuit', 'bus', 'endpoints', 'animated', 'connector']
  },
  {
    id: 'anim-line-wave',
    name: 'Animated Wave Stream',
    category: 'lines',
    sources: [],
    size: [160, 56],
    paths: [
      { d: 'M 6 50 Q 28 20 50 50 T 94 50', fill: 'none', dash: 'dash' },
      { d: 'M 78 36 L 94 50 L 78 64', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['wave stream', 'signal wave'],
    tags: ['line', 'wave', 'signal', 'stream', 'animated']
  },
  {
    id: 'anim-line-fork',
    name: 'Animated Branch / Fork',
    category: 'lines',
    sources: [],
    size: [150, 100],
    paths: [
      { d: 'M 8 50 L 48 50', fill: 'none', dash: 'dash' },
      { d: 'M 48 22 L 48 78', fill: 'none', dash: 'dash' },
      { d: 'M 48 22 L 90 22', fill: 'none', dash: 'dash' },
      { d: 'M 48 78 L 90 78', fill: 'none', dash: 'dash' },
      { d: 'M 78 12 L 92 22 L 78 32', fill: 'none' },
      { d: 'M 78 68 L 92 78 L 78 88', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['branch connector', 'fork line'],
    tags: ['line', 'fork', 'branch', 'split', 'animated']
  },
  {
    id: 'anim-line-loop',
    name: 'Animated Feedback Loop',
    category: 'lines',
    sources: [],
    size: [150, 84],
    paths: [
      { d: 'M 16 65 L 84 65 C 94 65 94 25 84 25 L 22 25', fill: 'none', dash: 'dash' },
      { d: 'M 36 13 L 18 25 L 36 37', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['feedback loop', 'return arrow'],
    tags: ['line', 'loop', 'feedback', 'return', 'animated']
  },
  {
    id: 'anim-line-diagonal',
    name: 'Animated Diagonal Vector',
    category: 'lines',
    sources: [],
    size: [130, 100],
    paths: [
      { d: 'M 12 86 L 88 14', fill: 'none', dash: 'dash' },
      { d: 'M 68 14 L 88 14 L 88 34', fill: 'none' }
    ],
    defaultLabel: '',
    aliases: ['diagonal vector', 'slope line'],
    tags: ['line', 'diagonal', 'vector', 'arrow', 'animated']
  }
]

export const AI_AND_MATH_SHAPES: LibraryShapeDef[] = [
  {
    id: 'ml-neural-net',
    name: 'Feed-Forward Neural Net (FFN)',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [210, 136],
    paths: [
      { d: 'M 8 6 H 92 A 6 6 0 0 1 98 12 V 88 A 6 6 0 0 1 92 94 H 8 A 6 6 0 0 1 2 88 V 12 A 6 6 0 0 1 8 6 Z', fill: 'fill' },
      { d: 'M 26 24 L 18 50 M 26 24 L 40 50 M 26 24 L 60 50 M 26 24 L 82 50 M 50 24 L 18 50 M 50 24 L 40 50 M 50 24 L 60 50 M 50 24 L 82 50 M 74 24 L 18 50 M 74 24 L 40 50 M 74 24 L 60 50 M 74 24 L 82 50', fill: 'none', sw: 0.45 },
      { d: 'M 18 50 L 26 76 M 18 50 L 50 76 M 18 50 L 74 76 M 40 50 L 26 76 M 40 50 L 50 76 M 40 50 L 74 76 M 60 50 L 26 76 M 60 50 L 50 76 M 60 50 L 74 76 M 82 50 L 26 76 M 82 50 L 50 76 M 82 50 L 74 76', fill: 'none', sw: 0.45 },
      { d: 'M 21 24 A 5 5 0 1 0 31 24 A 5 5 0 1 0 21 24 M 45 24 A 5 5 0 1 0 55 24 A 5 5 0 1 0 45 24 M 69 24 A 5 5 0 1 0 79 24 A 5 5 0 1 0 69 24', fill: 'light' },
      { d: 'M 13 50 A 5 5 0 1 0 23 50 A 5 5 0 1 0 13 50 M 35 50 A 5 5 0 1 0 45 50 A 5 5 0 1 0 35 50 M 55 50 A 5 5 0 1 0 65 50 A 5 5 0 1 0 55 50 M 77 50 A 5 5 0 1 0 87 50 A 5 5 0 1 0 77 50', fill: 'light' },
      { d: 'M 21 76 A 5 5 0 1 0 31 76 A 5 5 0 1 0 21 76 M 45 76 A 5 5 0 1 0 55 76 A 5 5 0 1 0 45 76 M 69 76 A 5 5 0 1 0 79 76 A 5 5 0 1 0 69 76', fill: 'light' }
    ],
    defaultFill: '#E0F2FE',
    defaultLabel: '',
    aliases: ['neural net', 'ffn', 'mlp', 'feed forward network', 'expert'],
    tags: ['ml', 'ai', 'transformer', 'moe', 'neural', 'ffn', 'mlp']
  },
  {
    id: 'ml-token-vector',
    name: 'Token Embedding Vector',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [110, 38],
    paths: [
      { d: 'M 4 12 H 96 V 88 H 4 Z', fill: 'fill' },
      { d: 'M 12 26 H 32 V 74 H 12 Z M 40 26 H 60 V 74 H 40 Z M 68 26 H 88 V 74 H 68 Z', fill: 'shade' }
    ],
    defaultFill: '#FCE7F3',
    defaultLabel: '',
    aliases: ['token vector', 'embedding vector', 'input token'],
    tags: ['ml', 'ai', 'token', 'embedding', 'vector', 'transformer']
  },
  {
    id: 'ml-adder',
    name: 'Residual Adder (⊕)',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [48, 48],
    paths: [
      { d: 'M 10 50 A 40 40 0 1 0 90 50 A 40 40 0 1 0 10 50', fill: 'fill' },
      { d: 'M 50 26 V 74 M 26 50 H 74', fill: 'none', sw: 1.2 }
    ],
    defaultFill: '#FEF9C3',
    defaultLabel: '',
    aliases: ['residual adder', 'plus junction', 'add norm'],
    tags: ['ml', 'ai', 'adder', 'residual', 'plus', 'transformer']
  },
  {
    id: 'ml-hadamard',
    name: 'Elementwise Multiply (⊗)',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [48, 48],
    paths: [
      { d: 'M 10 50 A 40 40 0 1 0 90 50 A 40 40 0 1 0 10 50', fill: 'fill' },
      { d: 'M 32 32 L 68 68 M 68 32 L 32 68', fill: 'none', sw: 1.2 }
    ],
    defaultFill: '#DCFCE7',
    defaultLabel: '',
    aliases: ['hadamard', 'multiply gate', 'elementwise', 'otimes'],
    tags: ['ml', 'ai', 'gate', 'multiply', 'swiglu', 'attention']
  },
  {
    id: 'ml-matmul',
    name: 'MatMul Block (×)',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [84, 52],
    paths: [
      { d: 'M 10 14 H 90 A 8 8 0 0 1 96 20 V 80 A 8 8 0 0 1 90 86 H 10 A 8 8 0 0 1 4 80 V 20 A 8 8 0 0 1 10 14 Z', fill: 'fill' }
    ],
    defaultFill: '#FFE4E6',
    defaultLabel: 'MatMul',
    aliases: ['matmul', 'linear', 'projection'],
    tags: ['ml', 'ai', 'matmul', 'linear', 'gemm', 'transformer']
  },
  {
    id: 'ml-norm-pill',
    name: 'LayerNorm / RMSNorm Pill',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [150, 44],
    paths: [
      { d: 'M 22 14 H 78 A 36 36 0 0 1 78 86 H 22 A 36 36 0 0 1 22 14 Z', fill: 'fill' }
    ],
    defaultFill: '#FEF08A',
    defaultLabel: 'RMSNorm',
    aliases: ['layernorm', 'rmsnorm', 'norm pill'],
    tags: ['ml', 'ai', 'norm', 'layernorm', 'rmsnorm', 'pill']
  },
  {
    id: 'ml-attention-head',
    name: 'Multi-Head Attention Block',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [190, 96],
    paths: [
      { d: 'M 14 14 H 90 A 6 6 0 0 1 96 20 V 72 A 6 6 0 0 1 90 78 H 14 A 6 6 0 0 1 8 72 V 20 A 6 6 0 0 1 14 14 Z', fill: 'shade' },
      { d: 'M 10 22 H 86 A 6 6 0 0 1 92 28 V 80 A 6 6 0 0 1 86 86 H 10 A 6 6 0 0 1 4 80 V 28 A 6 6 0 0 1 10 22 Z', fill: 'fill' }
    ],
    defaultFill: '#DBEAFE',
    defaultLabel: 'Multi-Head Attn',
    aliases: ['multi head attention', 'mha', 'gqa', 'self attention'],
    tags: ['ml', 'ai', 'attention', 'mha', 'gqa', 'transformer']
  },
  {
    id: 'ml-softmax-gate',
    name: 'Softmax / Gate Node',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [130, 48],
    paths: [
      { d: 'M 16 14 H 84 L 96 50 L 84 86 H 16 L 4 50 Z', fill: 'fill' }
    ],
    defaultFill: '#E9D5FF',
    defaultLabel: 'Softmax',
    aliases: ['softmax', 'router gate', 'activation'],
    tags: ['ml', 'ai', 'softmax', 'router', 'moe', 'gate']
  },
  {
    id: 'ml-concat',
    name: 'Concat / Projection Split',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [148, 52],
    paths: [
      { d: 'M 4 14 H 96 V 86 H 4 Z', fill: 'fill' },
      { d: 'M 33 14 V 86 M 67 14 V 86', fill: 'none', sw: 0.7 }
    ],
    defaultFill: '#E0E7FF',
    defaultLabel: 'Q | K | V',
    aliases: ['concat', 'qkv', 'split projection'],
    tags: ['ml', 'ai', 'qkv', 'concat', 'split', 'projection']
  },
  {
    id: 'ml-dashed-frame',
    name: 'Dashed Transformer Block Frame',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [240, 180],
    paths: [
      { d: 'M 8 4 H 92 A 6 6 0 0 1 96 10 V 90 A 6 6 0 0 1 92 96 H 8 A 6 6 0 0 1 4 90 V 10 A 6 6 0 0 1 8 4 Z', fill: 'none', dash: 'dash' }
    ],
    defaultFill: 'transparent',
    defaultLabel: 'N × Block',
    aliases: ['dashed frame', 'layer block', 'repeat block'],
    tags: ['ml', 'ai', 'container', 'dashed', 'layer', 'group']
  },
  {
    id: 'ml-rope-circle',
    name: 'Unit Circle / RoPE Angle (θ)',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [120, 120],
    paths: [
      { d: 'M 14 50 A 36 36 0 1 0 86 50 A 36 36 0 1 0 14 50', fill: 'light' },
      { d: 'M 6 50 H 94 M 50 94 V 6', fill: 'none', sw: 0.65 },
      { d: 'M 50 50 L 78 26', fill: 'none', sw: 1.1 },
      { d: 'M 68 50 A 18 18 0 0 0 64 38', fill: 'none', dash: 'dash', sw: 0.85 },
      { d: 'M 75 26 A 3 3 0 1 0 81 26 A 3 3 0 1 0 75 26', fill: 'solid' }
    ],
    defaultFill: '#E0F2FE',
    defaultLabel: '',
    aliases: ['rope', 'unit circle', 'rotation vector', 'phasor'],
    tags: ['math', 'ml', 'rope', 'circle', 'vector', 'angle']
  },
  {
    id: 'math-axes-xy',
    name: '2D X-Y Coordinate Axes',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [180, 130],
    paths: [
      { d: 'M 14 10 V 86 H 92', fill: 'none', sw: 1.1 },
      { d: 'M 9 18 L 14 10 L 19 18 M 84 81 L 92 86 L 84 91', fill: 'none', sw: 1.0 },
      { d: 'M 14 34 H 90 M 14 60 H 90 M 40 14 V 86 M 66 14 V 86', fill: 'none', dash: 'dot', sw: 0.45 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['xy axes', 'graph axes', 'coordinate plane'],
    tags: ['math', 'plot', 'graph', 'axes', 'chart']
  },
  {
    id: 'math-axes-quadrant',
    name: '4-Quadrant Cartesian Plane',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [160, 140],
    paths: [
      { d: 'M 8 50 H 92 M 50 92 V 8', fill: 'none', sw: 1.05 },
      { d: 'M 85 45 L 92 50 L 85 55 M 45 15 L 50 8 L 55 15', fill: 'none', sw: 1.0 },
      { d: 'M 29 12 V 88 M 71 12 V 88 M 12 29 H 88 M 12 71 H 88', fill: 'none', dash: 'dot', sw: 0.4 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['cartesian plane', 'quadrant axes', 'origin grid'],
    tags: ['math', 'plot', 'graph', 'quadrant', 'axes']
  },
  {
    id: 'math-sine-wave',
    name: 'Sine Wave on Axes',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [190, 110],
    paths: [
      { d: 'M 8 50 H 94 M 14 12 V 88', fill: 'none', sw: 0.7 },
      { d: 'M 14 50 C 26 14, 38 14, 50 50 C 62 86, 74 86, 86 50', fill: 'none', sw: 1.3 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['sine wave', 'sin(x)', 'waveform'],
    tags: ['math', 'plot', 'sine', 'wave', 'trigonometry', 'rope']
  },
  {
    id: 'math-cosine-wave',
    name: 'Cosine Wave on Axes',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [190, 110],
    paths: [
      { d: 'M 8 50 H 94 M 14 12 V 88', fill: 'none', sw: 0.7 },
      { d: 'M 14 20 C 26 20, 32 82, 50 82 C 68 82, 74 20, 86 20', fill: 'none', sw: 1.3 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['cosine wave', 'cos(x)'],
    tags: ['math', 'plot', 'cosine', 'wave', 'trigonometry']
  },
  {
    id: 'math-bell-curve',
    name: 'Gaussian Bell Curve',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [190, 115],
    paths: [
      { d: 'M 6 82 H 94 M 50 14 V 82', fill: 'none', sw: 0.7 },
      { d: 'M 10 80 C 28 80, 36 18, 50 18 C 64 18, 72 80, 90 80 Z', fill: 'fill' }
    ],
    defaultFill: '#DDD6FE',
    defaultLabel: '',
    aliases: ['gaussian', 'normal distribution', 'bell curve'],
    tags: ['math', 'plot', 'statistics', 'gaussian', 'probability']
  },
  {
    id: 'math-sigmoid',
    name: 'Sigmoid S-Curve',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [170, 110],
    paths: [
      { d: 'M 8 84 H 92 M 50 12 V 88', fill: 'none', sw: 0.65 },
      { d: 'M 10 80 C 38 80, 62 18, 90 18', fill: 'none', sw: 1.35 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['sigmoid', 'logistic curve'],
    tags: ['math', 'ml', 'plot', 'activation', 'sigmoid']
  },
  {
    id: 'math-relu-silu',
    name: 'SiLU / ReLU Curve',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [170, 110],
    paths: [
      { d: 'M 8 74 H 92 M 44 12 V 88', fill: 'none', sw: 0.65 },
      { d: 'M 10 74 C 24 74, 32 82, 44 74 L 88 18', fill: 'none', sw: 1.35 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['silu', 'relu', 'swish', 'activation curve'],
    tags: ['math', 'ml', 'plot', 'relu', 'silu', 'swish']
  },
  {
    id: 'math-lr-schedule',
    name: 'LR Warmup + Decay Plot',
    category: 'aiAndMath',
    sources: ['essentials'],
    size: [190, 115],
    paths: [
      { d: 'M 12 12 V 84 H 92', fill: 'none', sw: 0.8 },
      { d: 'M 12 84 L 30 20 C 48 20, 64 78, 90 80', fill: 'none', sw: 1.35 },
      { d: 'M 30 20 V 84', fill: 'none', dash: 'dash', sw: 0.65 }
    ],
    defaultFill: 'transparent',
    defaultLabel: '',
    aliases: ['lr decay', 'warmup cosine', 'loss curve'],
    tags: ['math', 'ml', 'plot', 'schedule', 'cosine', 'decay']
  }
]

export const ML_ARCHITECTURE_SHAPES = AI_AND_MATH_SHAPES

export const DATA_STRUCTURE_SHAPES: LibraryShapeDef[] = [
  {
    id: 'ds-array-4',
    name: '4-Cell Vector / Tensor Strip',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [180, 44],
    paths: [
      { d: 'M 4 12 H 96 V 88 H 4 Z', fill: 'fill' },
      { d: 'M 27 12 V 88 M 50 12 V 88 M 73 12 V 88', fill: 'none', sw: 0.9 }
    ],
    defaultFill: '#DBEAFE',
    defaultLabel: '',
    aliases: ['array 4', 'vector strip', 'cell strip 4', 'tensor strip'],
    tags: ['array', 'vector', 'tensor', 'cells', 'grid', 'strip']
  },
  {
    id: 'ds-array-6',
    name: '6-Cell Sequence / Token Strip',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [220, 42],
    paths: [
      { d: 'M 4 14 H 96 V 86 H 4 Z', fill: 'fill' },
      { d: 'M 19.3 14 V 86 M 34.6 14 V 86 M 50 14 V 86 M 65.3 14 V 86 M 80.6 14 V 86', fill: 'none', sw: 0.8 }
    ],
    defaultFill: '#DCFCE7',
    defaultLabel: '',
    aliases: ['array 6', 'token strip', 'sequence strip'],
    tags: ['array', 'tokens', 'sequence', 'cells', 'strip']
  },
  {
    id: 'ds-col-vector-4',
    name: 'Vertical Column Vector (4×1)',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [54, 168],
    paths: [
      { d: 'M 14 4 H 86 V 96 H 14 Z', fill: 'fill' },
      { d: 'M 14 27 H 86 M 14 50 H 86 M 14 73 H 86', fill: 'none', sw: 0.9 }
    ],
    defaultFill: '#FEF3C7',
    defaultLabel: '',
    aliases: ['column vector', 'vertical stack', '4x1 vector'],
    tags: ['vector', 'column', 'tensor', 'stack', 'vertical']
  },
  {
    id: 'ds-open-stack',
    name: 'Open-Top Stack Container',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [92, 168],
    paths: [
      { d: 'M 16 10 V 90 H 84 V 10', fill: 'none', sw: 1.2 },
      { d: 'M 16 50 H 84 V 90 H 16 Z', fill: 'fill' },
      { d: 'M 16 70 H 84', fill: 'none', sw: 0.8 }
    ],
    defaultFill: '#FFE4E6',
    defaultLabel: '',
    aliases: ['open stack', 'lifo stack', 'stack container'],
    tags: ['stack', 'lifo', 'open', 'data structure']
  },
  {
    id: 'ds-open-queue',
    name: 'Open-Ends Queue Channel',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [184, 52],
    paths: [
      { d: 'M 4 14 H 96 M 4 86 H 96', fill: 'none', sw: 1.2 },
      { d: 'M 22 22 H 78 V 78 H 22 Z', fill: 'fill' },
      { d: 'M 41 22 V 78 M 59 22 V 78', fill: 'none', sw: 0.8 }
    ],
    defaultFill: '#E0F2FE',
    defaultLabel: '',
    aliases: ['queue channel', 'fifo queue', 'buffer'],
    tags: ['queue', 'fifo', 'channel', 'buffer', 'open']
  },
  {
    id: 'ds-open-tray',
    name: 'Open Top U-Tray / Pool',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [140, 86],
    paths: [
      { d: 'M 10 12 V 86 A 4 4 0 0 0 14 90 H 86 A 4 4 0 0 0 90 86 V 12', fill: 'fill' }
    ],
    defaultFill: '#F1F5F9',
    defaultLabel: '',
    aliases: ['open container', 'u tray', 'beaker', 'memory pool'],
    tags: ['open', 'container', 'tray', 'memory']
  },
  {
    id: 'ds-matrix-3x3',
    name: '3×3 Matrix Grid',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [110, 110],
    paths: [
      { d: 'M 8 8 H 92 V 92 H 8 Z', fill: 'fill' },
      { d: 'M 36 8 V 92 M 64 8 V 92 M 8 36 H 92 M 8 64 H 92', fill: 'none', sw: 0.85 }
    ],
    defaultFill: '#EDE9FE',
    defaultLabel: '',
    aliases: ['matrix 3x3', 'grid 3x3', 'weight matrix'],
    tags: ['matrix', 'tensor', 'grid', '3x3', 'table']
  },
  {
    id: 'ds-matrix-4x4',
    name: '4×4 Attention / Weight Matrix',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [124, 124],
    paths: [
      { d: 'M 8 8 H 92 V 92 H 8 Z', fill: 'fill' },
      { d: 'M 29 8 V 92 M 50 8 V 92 M 71 8 V 92 M 8 29 H 92 M 8 50 H 92 M 8 71 H 92', fill: 'none', sw: 0.75 }
    ],
    defaultFill: '#E0F2FE',
    defaultLabel: '',
    aliases: ['matrix 4x4', 'attention matrix', 'grid 4x4'],
    tags: ['matrix', 'attention', 'grid', '4x4', 'tensor']
  },
  {
    id: 'ds-causal-mask',
    name: 'Causal Lower-Triangle Mask',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [120, 120],
    paths: [
      { d: 'M 8 8 H 92 V 92 H 8 Z', fill: 'fill' },
      { d: 'M 29 8 H 92 V 29 H 50 V 50 H 71 V 71 H 92 V 92', fill: 'shade' },
      { d: 'M 29 8 V 92 M 50 8 V 92 M 71 8 V 92 M 8 29 H 92 M 8 50 H 92 M 8 71 H 92', fill: 'none', sw: 0.75 }
    ],
    defaultFill: '#FEF08A',
    defaultLabel: '',
    aliases: ['causal mask', 'triangular mask', 'attention mask'],
    tags: ['matrix', 'causal', 'mask', 'attention', 'transformer']
  },
  {
    id: 'ds-kv-cache',
    name: 'KV Cache Block Grid',
    category: 'dataStructures',
    sources: ['essentials'],
    size: [160, 68],
    paths: [
      { d: 'M 6 10 H 94 V 44 H 6 Z M 6 56 H 94 V 90 H 6 Z', fill: 'fill' },
      { d: 'M 28 10 V 44 M 50 10 V 44 M 72 10 V 44 M 28 56 V 90 M 50 56 V 90 M 72 56 V 90', fill: 'none', sw: 0.8 }
    ],
    defaultFill: '#BAE6FD',
    defaultLabel: '',
    aliases: ['kv cache', 'key value cache', 'dual strip'],
    tags: ['kv', 'cache', 'tensor', 'transformer', 'memory']
  }
]

export const SHAPE_LIBRARY: ShapeLibraryFile = rawLibrary as unknown as ShapeLibraryFile
export const SHAPE_CATEGORIES: ShapeCategoryDef[] = [
  {
    id: 'aiAndMath',
    name: 'AI, Math & Plots',
    description: 'Neural blocks, RMSNorm/MatMul, axes & function curves',
    count: AI_AND_MATH_SHAPES.length
  },
  {
    id: 'dataStructures',
    name: 'Tensors, Arrays & Grids',
    description: 'Cell strips, vectors, stacks, queues & attention matrices',
    count: DATA_STRUCTURE_SHAPES.length
  },
  ...SHAPE_LIBRARY.categories.map((cat) => ({
    ...cat,
    description: CATEGORY_DESCRIPTION_OVERRIDES[cat.id] ?? sanitizeDisplayText(cat.description)
  }))
]
export const ALL_LIBRARY_SHAPES: LibraryShapeDef[] = [
  ...AI_AND_MATH_SHAPES,
  ...DATA_STRUCTURE_SHAPES,
  ...SHAPE_LIBRARY.shapes.map((s) => ({
    ...s,
    name: sanitizeDisplayText(s.name)
  }))
]

export const SHAPE_BY_ID: Map<string, LibraryShapeDef> = new Map([
  ...ALL_LIBRARY_SHAPES.map((s) => [s.id.toLowerCase(), s] as const),
  ...ANIMATED_LINE_SHAPES.map((s) => [s.id.toLowerCase(), s] as const)
])

export const SHAPE_BY_ALIAS: Map<string, LibraryShapeDef> = (() => {
  const map = new Map<string, LibraryShapeDef>()
  for (const s of [...ALL_LIBRARY_SHAPES, ...ANIMATED_LINE_SHAPES]) {
    for (const alias of s.aliases ?? []) {
      const key = alias.toLowerCase().trim()
      if (key && !map.has(key)) {
        map.set(key, s)
      }
    }
  }
  return map
})()

/**
 * Resolves a shape definition by exact ID, lowercase ID, or registered alias.
 */
export function getLibraryShape(idOrAlias: string): LibraryShapeDef | undefined {
  if (!idOrAlias) return undefined
  const trimmed = idOrAlias.trim()
  const lower = trimmed.toLowerCase()
  return (
    SHAPE_BY_ID.get(lower) ??
    SHAPE_BY_ALIAS.get(lower) ??
    SHAPE_BY_ALIAS.get(lower.replace(/[\s_]+/g, '-'))
  )
}

export function resolvePathFill(
  role: ShapePathRole,
  fillColor: string,
  strokeColor: string
): string {
  switch (role) {
    case 'fill':
      return fillColor
    case 'none':
      return 'none'
    case 'shade':
      return 'rgba(0, 0, 0, 0.28)'
    case 'light':
      return 'rgba(255, 255, 255, 0.22)'
    case 'solid':
      return strokeColor
  }
}

export function resolveDashArray(dash?: ShapeDashKind): string | undefined {
  if (dash === 'dash') return '6 4'
  if (dash === 'dot') return '2 3'
  if (dash === 'dashdot') return '6 3 2 3'
  return undefined
}

function resolveDashSegments(dash?: ShapeDashKind): number[] {
  if (dash === 'dash') return [8, 5]
  if (dash === 'dot') return [2, 4]
  if (dash === 'dashdot') return [8, 4, 2, 4]
  return []
}

/**
 * Renders any library shape onto a Canvas2D context using Path2D + DOMMatrix
 * so strokes remain crisp and non-scaling across arbitrary aspect ratios.
 */
export function drawLibraryShapeOnCanvas(
  ctx: CanvasRenderingContext2D,
  shape: LibraryShapeDef,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillColor: string,
  strokeWidth = 3,
  fillOpacity = 1,
  animated = false,
  animTimeMs = 0
): { labelX: number; labelY: number } {
  const rx = w < 0 ? x + w : x
  const ry = h < 0 ? y + h : y
  const rw = Math.max(1, Math.abs(w))
  const rh = Math.max(1, Math.abs(h))
  const clampedOpacity = Math.max(0, Math.min(1, fillOpacity))

  const matrix = new DOMMatrix().translate(rx, ry).scale(rw / 100, rh / 100)

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const p of shape.paths) {
    const scaledPath = new Path2D()
    scaledPath.addPath(new Path2D(p.d), matrix)

    const pathFill = resolvePathFill(p.fill, fillColor, strokeColor)
    if (pathFill !== 'none' && pathFill !== 'transparent' && clampedOpacity > 0) {
      ctx.save()
      ctx.shadowColor = 'transparent'
      ctx.shadowBlur = 0
      if (clampedOpacity < 1) {
        ctx.globalAlpha *= clampedOpacity
      }
      ctx.fillStyle = pathFill
      ctx.fill(scaledPath, p.rule ?? 'nonzero')
      ctx.restore()
    }

    const pathStroke = p.stroke === 'none' ? 'none' : (p.stroke ?? strokeColor)
    if (pathStroke !== 'none') {
      const effectiveSw = (p.sw ?? 1) * strokeWidth
      if (animated) {
        // 1. Subtle base contour guide (matches ShapeSvg preview strokeOpacity=0.28)
        ctx.save()
        ctx.globalAlpha *= 0.28
        ctx.strokeStyle = pathStroke
        ctx.lineWidth = effectiveSw
        ctx.setLineDash(resolveDashSegments(p.dash))
        ctx.lineDashOffset = 0
        ctx.stroke(scaledPath)
        ctx.restore()

        // 2. Live marching-ants flow overlay
        const flowDash =
          p.dash === 'dot' ? [3, 6] : p.dash === 'dashdot' ? [8, 4, 2, 4] : [10, 6]
        const flowCycle = flowDash.reduce((acc, seg) => acc + seg, 0)
        ctx.save()
        ctx.strokeStyle = pathStroke
        ctx.lineWidth = Math.max(1.5, effectiveSw)
        ctx.setLineDash(flowDash)
        ctx.lineDashOffset = -((animTimeMs / 24) % flowCycle)
        ctx.stroke(scaledPath)
        ctx.restore()
      } else {
        ctx.strokeStyle = pathStroke
        ctx.lineWidth = effectiveSw
        ctx.setLineDash(resolveDashSegments(p.dash))
        ctx.lineDashOffset = 0
        ctx.stroke(scaledPath)
      }
    }
  }

  ctx.restore()

  const [tx, ty, tw, th] = shape.text ?? [8, 8, 84, 84]
  return {
    labelX: rx + ((tx + tw / 2) / 100) * rw,
    labelY: ry + ((ty + th / 2) / 100) * rh
  }
}

function escapeAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Generates an inline nested <svg> block for any library shape suitable for SVG export.
 */
export function renderLibraryShapeSvgGroup(
  shape: LibraryShapeDef,
  x: number,
  y: number,
  w: number,
  h: number,
  strokeColor: string,
  fillColor: string,
  strokeWidth = 2.5,
  fillOpacity = 1
): string {
  const rx = w < 0 ? x + w : x
  const ry = h < 0 ? y + h : y
  const rw = Math.max(1, Math.abs(w))
  const rh = Math.max(1, Math.abs(h))
  const clampedOpacity = Math.max(0, Math.min(1, fillOpacity))

  const paths = shape.paths
    .map((p) => {
      const pathStroke = p.stroke === 'none' ? 'none' : (p.stroke ?? strokeColor)
      const rawFill = resolvePathFill(p.fill, fillColor, strokeColor)
      const pathFill = rawFill === 'transparent' || clampedOpacity <= 0 ? 'none' : rawFill
      const sw = pathStroke === 'none' ? 0 : (p.sw ?? 1) * strokeWidth
      const dash = resolveDashArray(p.dash)
      const ruleAttr = p.rule ? ` fill-rule="${p.rule}"` : ''
      const fillOpacityAttr =
        pathFill !== 'none' && clampedOpacity < 1 ? ` fill-opacity="${clampedOpacity}"` : ''
      const dashAttr = dash ? ` stroke-dasharray="${dash}"` : ''
      return `    <path d="${escapeAttr(p.d)}" fill="${escapeAttr(pathFill)}"${fillOpacityAttr}${ruleAttr} stroke="${escapeAttr(pathStroke)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashAttr} vector-effect="non-scaling-stroke" />`
    })
    .join('\n')

  return `  <svg x="${rx}" y="${ry}" width="${rw}" height="${rh}" viewBox="0 0 100 100" preserveAspectRatio="none">\n${paths}\n  </svg>\n`
}
