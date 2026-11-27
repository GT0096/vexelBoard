import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { SaveSkillInput, SkillDetail, SkillSourceKind, SkillSummary } from '../shared/ipc'

let configuredUserDataDir = ''
let configuredWorkspaceDir = process.cwd()

export function configureSkillPaths(opts: { userDataDir?: string; workspaceDir?: string }): void {
  if (opts.userDataDir) configuredUserDataDir = opts.userDataDir
  if (opts.workspaceDir) configuredWorkspaceDir = opts.workspaceDir
}

function getWorkspaceRoot(): string {
  return configuredWorkspaceDir || process.cwd()
}

function getCustomSkillsRoot(): string | null {
  return configuredUserDataDir ? join(configuredUserDataDir, 'skills') : null
}

function getAntigravitySkillsRoots(): string[] {
  const home = homedir()
  return [join(home, '.gemini', 'config', 'skills'), join(home, '.agents', 'skills')]
}

function getAntigravityPluginRoots(): string[] {
  const home = homedir()
  return [join(home, '.gemini', 'config', 'plugins')]
}

function slugifySkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/**
 * Parse an Antigravity-compatible `SKILL.md` file with YAML frontmatter (`name`, `description`),
 * supporting inline quotes and YAML block scalars (`>`, `>-`, `|`, `|-`).
 */
export function parseSkillMarkdown(raw: string): {
  name: string
  description: string
  body: string
} {
  const normalized = String(raw || '').replace(/\r\n/g, '\n')
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    return {
      name: '',
      description: '',
      body: normalized.trim()
    }
  }

  const frontmatter = match[1]
  const body = match[2].trim()
  const lines = frontmatter.split('\n')

  let name = ''
  let description = ''
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) {
      i++
      continue
    }
    const key = kv[1].toLowerCase()
    const rest = kv[2].trim()

    if (rest === '>' || rest === '>-' || rest === '|' || rest === '|-') {
      const blockLines: string[] = []
      i++
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        blockLines.push(lines[i].replace(/^\s+/, ''))
        i++
      }
      const joined = blockLines
        .join(rest.startsWith('|') ? '\n' : ' ')
        .replace(/\s+/g, rest.startsWith('|') ? '\n' : ' ')
        .trim()
      if (key === 'name') name = joined
      else if (key === 'description') description = joined
      continue
    }

    const unquoted = rest.replace(/^["']|["']$/g, '').trim()
    if (key === 'name') name = unquoted
    else if (key === 'description') description = unquoted
    i++
  }

  return { name, description, body }
}

interface InternalSkillRecord extends SkillDetail {}

const BUILTIN_SKILLS_DATA: Array<{ name: string; description: string; body: string }> = [
  {
    name: 'vexel-architecture-visualizer',
    description:
      'Design clean multi-tier software architectures, distributed pipelines, ERDs, and flowcharts on the Vexelboard canvas using native SpatialScene or interactive diagrams.',
    body: `# Vexel Architecture Visualizer

Use this skill whenever the user asks to design, explain, or refactor a software system, cloud topology, microservice flow, database schema, or state machine on Vexelboard.

## Workflow
1. Call \`search_board_assets\` first with the system keywords to inspect available node shapes (\`database\`, \`cloud\`, \`service\`, \`queue\`, \`actor\`) and semantic color palettes.
2. Decompose the architecture into clear stages (Clients/Edge -> Gateway/Auth -> Services -> Event Bus -> Storage/Observability).
3. Use \`create_interactive_diagram\` for connected graph topologies (\`direction: "LR"\` or \`"TB"\`, \`animated: true\` for live request/data pulses) OR \`create_vector_diagram\` when you need custom swimlanes, protocol layers, or timing plots.
4. Always omit \`x\` and \`y\` on standalone creation tools so Vexelboard places cards in an empty canvas region without overlapping existing notes.
5. Pair complex topologies with a concise Markdown summary note (\`add_note_card\`) highlighting bottlenecks, SLAs, and trade-offs.`
  },
  {
    name: 'vexel-first-principles-tutor',
    description:
      'Break down physics, mathematics, chemistry, biology, or CS concepts from first principles into SpatialScene 2D diagrams, interactive canvas-immersed 3D rigs/objects (`create_3d_scene` + in-note ```3d blocks), KaTeX derivations, and step-by-step board notes.',
    body: `# First-Principles Visual Tutor

Activate this skill when teaching or deriving scientific, mathematical, or engineering concepts visually.

## Workflow
1. Inspect \`search_board_assets\` for domain color tokens, fonts (\`serif\`/\`mono\`), and geometric primitives.
2. Identify the fundamental governing laws or conservation principles first (e.g., Schrödinger / Conservation / Thermodynamics / Bell Curve / Gradient Descent).
3. For 2D geometry, build a clean \`SpatialScene\` (` + '`create_vector_diagram`' + `) using concentric circles, custom Bezier \`svg_path\` contours, smooth curved \`connector\` splines, and collision-free labels.
4. For 3D experimental rigs, kinematics (e.g. \`car\`, \`optics_bench\`, \`mechanics_rig\`, \`chemistry_setup\`, \`electromagnetism\`), or ` + '`z = f(x, y)`' + ` surfaces (\`surface_wave\`), call \`create_3d_scene\` (immersed on the canvas) or embed \`\`\`3d JSON blocks directly inside \`add_note_card\`.
5. Render exact equations via \`add_equation\` (valid LaTeX / KaTeX) right beside the visual.
6. Add a structured \`add_note_card\` summarizing intuition, boundary cases, and real-world applications.`
  },
  {
    name: 'vexel-code-workbench',
    description:
      'Write modular runnable code, connect Coding Tabs to downstream Code Cards, 2D Graphs, and 3D Scenes with flowchart connectors (`connect_board_elements`), verify locally with `run_code`, and pair algorithms with complexity math.',
    body: `# Vexel Code Workbench

Use this workflow when solving coding problems, building connected multi-card compute -> visualize workflows, or debugging active Code Cards.

## Workflow
1. If debugging an existing card, inspect \`activeCodeContext\` or call \`inspect_board\` to read its current code, element IDs, and error output.
2. Draft clean, well-typed code that reads incoming upstream stage output from \`sys.stdin\` when wired after another Code Card, and optionally prints \`{"plot2d": ...}\`, numeric CSV/TSV, or \`{"scene3d": ...}\` to drive connected 2D Graphs or 3D Scenes.
3. Always run \`run_code\` locally to verify stdout/stderr before finalizing (when a local runtime is available).
4. Use \`create_or_patch_code\` (supplying \`cardId\` to update an existing card in place, or omitting it for a new card).
5. Wire Coding Tabs -> Coding Tabs / 2D Graphs / 3D Scenes on the board using \`connect_board_elements\` (\`sourceId\`, \`targetId\`, \`animated: true\`) — just like flowchart shapes! Running any Code Card executes downstream connected Code Cards and live-updates connected graphs/3D scenes.
6. Pair algorithmic solutions with \`add_equation\` for time/space complexity and optional \`create_3d_scene\` / \`create_vector_diagram\` visualizations.`
  },
  {
    name: 'vexel-research-synthesizer',
    description:
      'Conduct grounded deep research across uploaded Knowledge Studio documents and live open-source web search (`web_search` + `fetch_webpage`), producing cited notes and concept maps.',
    body: `# Grounded Research Synthesizer

Use this skill for deep technical investigation, literature synthesis, fact-checking current releases, or comparing frameworks using both local Knowledge Studio sources and the open web.

## Workflow
1. If indexed Knowledge Studio sources exist (\`knowledgeSourceCount > 0\`), search them first using \`search_knowledge_base\`.
2. For live/external facts, call \`web_search\` with focused queries (you can filter by \`category\`: \`general\`, \`news\`, \`science\`, \`it\`, or \`timeRange\`).
3. Call \`fetch_webpage\` (batched up to 3 URLs via \`action.type = "tools"\`) on the strongest URLs with \`query\` to extract high-signal passages.
4. Never fabricate URLs or quotes. Cite every external claim with Markdown links \`[Title](url)\`.
5. Synthesize key findings onto the board with \`add_note_card\` (structured bullet insights + clickable sources) and an optional synthesis diagram.`
  }
]

function scanSkillFolder(
  dirPath: string,
  source: SkillSourceKind,
  editable: boolean,
  fallbackName?: string
): InternalSkillRecord | null {
  const skillMdPath = join(dirPath, 'SKILL.md')
  if (!existsSync(skillMdPath)) return null
  try {
    const rawMarkdown = readFileSync(skillMdPath, 'utf8')
    const parsed = parseSkillMarkdown(rawMarkdown)
    const name = slugifySkillName(parsed.name || fallbackName || basename(dirPath))
    if (!name) return null
    const refsDir = join(dirPath, 'references')
    const scriptsDir = join(dirPath, 'scripts')
    const referenceFiles = existsSync(refsDir)
      ? readdirSync(refsDir).filter((f) => /\.(md|txt|json)$/i.test(f))
      : []
    const scriptFiles = existsSync(scriptsDir)
      ? readdirSync(scriptsDir).filter((f) => /\.(mjs|js|ts|py|ps1|sh)$/i.test(f))
      : []

    return {
      id: `${source}:${name}`,
      name,
      description: parsed.description || `Workflow skill loaded from ${basename(dirPath)}`,
      source,
      skillPath: skillMdPath,
      dirPath,
      hasReferences: referenceFiles.length > 0,
      hasScripts: scriptFiles.length > 0,
      editable,
      body: parsed.body,
      rawMarkdown,
      referenceFiles,
      scriptFiles
    }
  } catch {
    return null
  }
}

function scanSkillsDirectory(
  rootDir: string | null,
  source: SkillSourceKind,
  editable: boolean
): InternalSkillRecord[] {
  if (!rootDir || !existsSync(rootDir)) return []
  const found: InternalSkillRecord[] = []
  try {
    const entries = readdirSync(rootDir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const rec = scanSkillFolder(join(rootDir, ent.name), source, editable, ent.name)
      if (rec) found.push(rec)
    }
  } catch {
    // ignore unreadable directory
  }
  return found
}

function scanPluginSkillsDirectories(): InternalSkillRecord[] {
  const found: InternalSkillRecord[] = []
  for (const pluginsRoot of getAntigravityPluginRoots()) {
    if (!existsSync(pluginsRoot)) continue
    try {
      const plugins = readdirSync(pluginsRoot, { withFileTypes: true })
      for (const plg of plugins) {
        if (!plg.isDirectory()) continue
        const skillsDir = join(pluginsRoot, plg.name, 'skills')
        if (!existsSync(skillsDir)) continue
        const directSkill = scanSkillFolder(skillsDir, 'antigravity-plugin', false, plg.name)
        if (directSkill) found.push(directSkill)
        found.push(...scanSkillsDirectory(skillsDir, 'antigravity-plugin', false))
      }
    } catch {
      // ignore unreadable plugin root
    }
  }
  return found
}

function collectAllSkillRecords(): InternalSkillRecord[] {
  const byName = new Map<string, InternalSkillRecord>()
  const addRecords = (items: InternalSkillRecord[]): void => {
    for (const item of items) {
      const key = item.name.toLowerCase()
      if (!byName.has(key)) {
        byName.set(key, item)
      }
    }
  }

  // 1. Workspace .agents/skills (highest precedence, shared directly with Antigravity)
  addRecords(scanSkillsDirectory(join(getWorkspaceRoot(), '.agents', 'skills'), 'workspace', true))
  // 2. Vexelboard userData/skills
  addRecords(scanSkillsDirectory(getCustomSkillsRoot(), 'custom', true))
  // 3. Antigravity global user skills (~/.gemini/config/skills & ~/.agents/skills)
  for (const agyDir of getAntigravitySkillsRoots()) {
    addRecords(scanSkillsDirectory(agyDir, 'antigravity', false))
  }
  // 4. Antigravity installed plugin skills
  addRecords(scanPluginSkillsDirectories())
  // 5. Built-in Vexelboard skills
  addRecords(
    BUILTIN_SKILLS_DATA.map((b) => ({
      id: `builtin:${b.name}`,
      name: b.name,
      description: b.description,
      source: 'builtin' as const,
      skillPath: `builtin://${b.name}`,
      hasScripts: false,
      hasReferences: false,
      editable: false,
      body: b.body,
      rawMarkdown: `---\nname: ${b.name}\ndescription: >-\n  ${b.description}\n---\n\n${b.body}\n`,
      referenceFiles: [],
      scriptFiles: []
    }))
  )

  return Array.from(byName.values())
}

function toSummary(rec: InternalSkillRecord): SkillSummary {
  return {
    id: rec.id,
    name: rec.name,
    description: rec.description,
    source: rec.source,
    skillPath: rec.skillPath,
    ...(rec.dirPath ? { dirPath: rec.dirPath } : {}),
    hasScripts: rec.hasScripts,
    hasReferences: rec.hasReferences,
    editable: rec.editable
  }
}

export function listAllSkills(): SkillSummary[] {
  return collectAllSkillRecords().map(toSummary)
}

export function getSkillDetail(idOrName: string, referenceFile?: string): SkillDetail | null {
  const needle = idOrName.trim().toLowerCase()
  if (!needle) return null
  const all = collectAllSkillRecords()
  const rec =
    all.find((r) => r.id.toLowerCase() === needle) ||
    all.find((r) => r.name.toLowerCase() === needle)
  if (!rec) return null

  if (referenceFile && rec.dirPath) {
    const refsDir = resolve(rec.dirPath, 'references')
    const target = resolve(refsDir, basename(referenceFile))
    if (target.startsWith(refsDir) && existsSync(target)) {
      try {
        const refContent = readFileSync(target, 'utf8')
        return {
          ...rec,
          body: `${rec.body}\n\n## Reference: ${basename(referenceFile)}\n\n${refContent.slice(0, 6000)}`
        }
      } catch {
        // ignore read error and return base body
      }
    }
  }

  return rec
}

export function selectSkillsForPrompt(
  query: string,
  activeSkillIds?: string[],
  maxPluginSkills = 12
): { catalog: SkillSummary[]; activeDetails: SkillDetail[] } {
  const all = collectAllSkillRecords()
  const activeSet = new Set((activeSkillIds ?? []).map((s) => s.toLowerCase()))

  const activeDetails: SkillDetail[] = []
  const coreCatalog: SkillSummary[] = []
  const pluginCandidates: Array<{ score: number; summary: SkillSummary }> = []

  const terms = Array.from(
    new Set(
      String(query || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 3)
    )
  )

  for (const rec of all) {
    if (activeSet.has(rec.id.toLowerCase()) || activeSet.has(rec.name.toLowerCase())) {
      activeDetails.push(rec)
    }
    if (rec.source !== 'antigravity-plugin') {
      coreCatalog.push(toSummary(rec))
    } else {
      const hay = `${rec.name} ${rec.description}`.toLowerCase()
      let score = 0
      for (const term of terms) {
        if (hay.includes(term)) score += rec.name.includes(term) ? 3 : 1
      }
      if (score > 0 || activeSet.has(rec.id.toLowerCase())) {
        pluginCandidates.push({ score: score + 1, summary: toSummary(rec) })
      }
    }
  }

  pluginCandidates.sort((a, b) => b.score - a.score)
  const selectedPlugins = pluginCandidates.slice(0, maxPluginSkills).map((p) => p.summary)

  return {
    catalog: [...coreCatalog, ...selectedPlugins],
    activeDetails
  }
}

function buildSkillMarkdownText(name: string, description: string, body: string): string {
  const cleanDesc = description.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
  return `---\nname: ${name}\ndescription: >-\n  ${cleanDesc}\n---\n\n${body.trim()}\n`
}

function resolveTargetSkillDir(target: 'workspace' | 'custom' | 'antigravity', slug: string): string {
  if (target === 'workspace') {
    return join(getWorkspaceRoot(), '.agents', 'skills', slug)
  }
  if (target === 'antigravity') {
    return join(homedir(), '.gemini', 'config', 'skills', slug)
  }
  const customRoot = getCustomSkillsRoot()
  if (customRoot) {
    return join(customRoot, slug)
  }
  return join(getWorkspaceRoot(), '.agents', 'skills', slug)
}

export function saveSkill(input: SaveSkillInput): { ok: boolean; skill?: SkillSummary; error?: string } {
  const slug = slugifySkillName(input.name)
  if (!slug) {
    return { ok: false, error: 'Skill name must contain letters or numbers.' }
  }
  const desc = input.description.trim()
  if (!desc) {
    return { ok: false, error: 'Skill description is required so agents know when to activate it.' }
  }
  const body = input.body.trim()
  if (!body) {
    return { ok: false, error: 'Skill instructions body cannot be empty.' }
  }

  try {
    const dir = resolveTargetSkillDir(input.target, slug)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'SKILL.md')
    writeFileSync(filePath, buildSkillMarkdownText(slug, desc, body), 'utf8')
    const rec = scanSkillFolder(dir, input.target, input.target !== 'antigravity', slug)
    return {
      ok: true,
      skill: rec ? toSummary(rec) : undefined
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export function deleteSkill(idOrName: string): { ok: boolean; error?: string } {
  const detail = getSkillDetail(idOrName)
  if (!detail) {
    return { ok: false, error: 'Skill not found.' }
  }
  if (!detail.editable || !detail.dirPath) {
    return { ok: false, error: `Cannot delete ${detail.source} skill "${detail.name}".` }
  }
  try {
    rmSync(detail.dirPath, { recursive: true, force: true })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function exportSkillToTarget(
  idOrName: string,
  target: 'workspace' | 'antigravity'
): { ok: boolean; targetPath?: string; error?: string } {
  const detail = getSkillDetail(idOrName)
  if (!detail) {
    return { ok: false, error: 'Skill not found.' }
  }
  try {
    const dir = resolveTargetSkillDir(target, detail.name)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'SKILL.md')
    writeFileSync(filePath, detail.rawMarkdown, 'utf8')
    return { ok: true, targetPath: filePath }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
