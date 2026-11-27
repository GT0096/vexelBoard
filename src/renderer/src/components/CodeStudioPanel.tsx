import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror'
import type { LanguageName } from '@uiw/codemirror-extensions-langs'

type CmLangsModule = typeof import('@uiw/codemirror-extensions-langs')
let cachedCmLangs: CmLangsModule | null = null
let cachedCmLangsPromise: Promise<CmLangsModule> | null = null

function loadCmLangsModule(): Promise<CmLangsModule> {
  if (cachedCmLangs) return Promise.resolve(cachedCmLangs)
  if (!cachedCmLangsPromise) {
    cachedCmLangsPromise = import('@uiw/codemirror-extensions-langs').then((mod) => {
      cachedCmLangs = mod
      return mod
    })
  }
  return cachedCmLangsPromise
}

// Static name index so the language search picker stays responsive without pulling the full grammar bundle eagerly.
const CM_LANG_NAMES: readonly string[] = [
  'apl', 'asn', 'asn1', 'bash', 'bzl', 'c', 'c++', 'cc', 'cfg', 'cjs', 'cl', 'clj', 'cljc', 'cljs', 'cmake',
  'cob', 'coffee', 'cpp', 'cql', 'cr', 'cs', 'css', 'cts', 'cxx', 'cypher', 'd', 'dart', 'diff', 'dtd', 'dylan',
  'ecl', 'edn', 'elm', 'erl', 'f90', 'f95', 'factor', 'feature', 'forth', 'fs', 'go', 'gradle', 'groovy', 'gss',
  'h', 'handlebars', 'hbs', 'hpp', 'hs', 'htm', 'html', 'hx', 'ini', 'ino', 'j2', 'jade', 'java', 'jinja',
  'jinja2', 'jl', 'js', 'json', 'jsonld', 'jsx', 'ksh', 'kt', 'kts', 'less', 'liquid', 'lisp', 'ls', 'lua',
  'markdown', 'mbox', 'md', 'mjs', 'ml', 'mli', 'mm', 'mo', 'mts', 'nix', 'nt', 'oz', 'pas', 'patch', 'pgp',
  'php', 'pig', 'pl', 'pls', 'pm', 'pp', 'properties', 'proto', 'ps1', 'pug', 'py', 'python', 'r', 'rb', 'rs',
  'sas', 'sass', 'scala', 'scm', 'scss', 'sh', 'sieve', 'sml', 'solidity', 'sparql', 'sql', 'st', 'styl', 'sv',
  'svelte', 'svg', 'swift', 'tcl', 'tex', 'text', 'textile', 'toml', 'ts', 'tsx', 'ttcn', 'ttl', 'v', 'vb',
  'vbs', 'vhd', 'vhdl', 'vue', 'wast', 'wat', 'webidl', 'xml', 'xquery', 'xsd', 'xsl', 'yaml', 'yml', 'z80'
]
import {
  Play,
  Plus,
  X,
  Terminal,
  Copy,
  Check,
  Trash2,
  Pin,
  FilePlus2,
  RotateCcw,
  ChevronDown,
  Search,
  Maximize2,
  Minimize2,
  GripHorizontal,
  Loader2,
  Code2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Globe,
  SlidersHorizontal,
  Sparkles,
  LineChart,
  Box,
  HelpCircle
} from 'lucide-react'
import type { CodeRuntimeInfo } from '@shared/ipc'
import type { Scene3DSpec } from '@shared/scene3dSchema'
import type { CodeNode, CodeTabExecutionOutput, CodeTabItem, PortSide } from '../types/board'
import type { ResizeDirection } from './CanvasElements'
import { TabColorPicker, getReadableTabStyle } from './TabColorPicker'
import type { GraphPlotSpec } from '../board/graphPlotBuilder'
import { parseCodeOutputToVisuals, wrapCodeForAutoOutput } from '../board/codeVisualParser'
import { Inline3DViewer } from './Canvas3DScene'
import { InteractiveGraphViewport } from './CanvasGraphCard'

const STUDIO_STORAGE_KEY = 'vgb.codingStudio.v1'

interface RunnableLanguageDef {
  id: string
  label: string
  ext: string
  cmLang: LanguageName
  runtimeId: string
  starter: string
}

const RUNNABLE_LANGUAGES: RunnableLanguageDef[] = [
  {
    id: 'python',
    label: 'Python',
    ext: 'py',
    cmLang: 'python',
    runtimeId: 'python',
    starter: `# Python 3 — Press Ctrl+Enter or click Run
def fibonacci(n: int) -> list[int]:
    seq = [0, 1]
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq[:n]

nums = fibonacci(10)
print("Fibonacci(10):", nums)
print("Sum:", sum(nums))
`
  },
  {
    id: 'javascript',
    label: 'JavaScript (Node)',
    ext: 'js',
    cmLang: 'js',
    runtimeId: 'javascript',
    starter: `// JavaScript (Node.js) — Press Ctrl+Enter or click Run
const tasks = ['Sketch', 'Diagram', 'Code', 'Ship']

const summary = tasks.map((t, i) => \`\${i + 1}. \${t}\`).join('\\n')
console.log('Board Pipeline:\\n' + summary)
console.log('Total steps:', tasks.length)
`
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    ext: 'ts',
    cmLang: 'ts',
    runtimeId: 'typescript',
    starter: `// TypeScript — Press Ctrl+Enter or click Run
interface Point {
  x: number
  y: number
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

const d = distance({ x: 3, y: 4 }, { x: 9, y: 12 })
console.log('Euclidean distance:', d)
`
  },
  {
    id: 'html',
    label: 'HTML / CSS / JS (Live)',
    ext: 'html',
    cmLang: 'html',
    runtimeId: 'browser',
    starter: `<!-- Live HTML / CSS / JS Preview — Click Run or Ctrl+Enter -->
<div class="card">
  <h3>Interactive Widget</h3>
  <p id="status">Clicks: 0</p>
  <button id="btn">Increment</button>
</div>

<style>
  body {
    margin: 0;
    padding: 16px;
    font-family: system-ui, sans-serif;
    background: #0f172a;
    color: #f8fafc;
  }
  .card {
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(56, 189, 248, 0.35);
    background: rgba(30, 41, 59, 0.8);
  }
  button {
    padding: 8px 14px;
    border-radius: 8px;
    border: none;
    background: #38bdf8;
    color: #0f172a;
    font-weight: 700;
    cursor: pointer;
  }
</style>

<script>
  let count = 0
  document.getElementById('btn').addEventListener('click', () => {
    count++
    document.getElementById('status').textContent = 'Clicks: ' + count
    console.log('Button clicked -> count =', count)
  })
</script>
`
  },
  {
    id: 'cpp',
    label: 'C++',
    ext: 'cpp',
    cmLang: 'cpp',
    runtimeId: 'cpp',
    starter: `// C++ (g++ / clang++) — Press Ctrl+Enter or click Run
#include <iostream>
#include <vector>

int main() {
    std::vector<int> vals = {1, 2, 3, 5, 8, 13};
    int sum = 0;
    for (int v : vals) sum += v;
    std::cout << "Sum of sequence = " << sum << std::endl;
    return 0;
}
`
  },
  {
    id: 'c',
    label: 'C',
    ext: 'c',
    cmLang: 'c',
    runtimeId: 'c',
    starter: `// C (gcc / clang) — Press Ctrl+Enter or click Run
#include <stdio.h>

int main(void) {
    for (int i = 1; i <= 5; i++) {
        printf("Square(%d) = %d\\n", i, i * i);
    }
    return 0;
}
`
  },
  {
    id: 'java',
    label: 'Java',
    ext: 'java',
    cmLang: 'java',
    runtimeId: 'java',
    starter: `// Java (javac + java) — Press Ctrl+Enter or click Run
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from Java on Vexelboard!");
        for (int i = 1; i <= 4; i++) {
            System.out.println("2^" + i + " = " + (1 << i));
        }
    }
}
`
  },
  {
    id: 'go',
    label: 'Go',
    ext: 'go',
    cmLang: 'go',
    runtimeId: 'go',
    starter: `// Go (go run) — Press Ctrl+Enter or click Run
package main

import "fmt"

func main() {
    items := []string{"alpha", "beta", "gamma"}
    for i, item := range items {
        fmt.Printf("[%d] %s\\n", i, item)
    }
}
`
  },
  {
    id: 'rust',
    label: 'Rust',
    ext: 'rs',
    cmLang: 'rs',
    runtimeId: 'rust',
    starter: `// Rust (rustc) — Press Ctrl+Enter or click Run
fn main() {
    let sum: i32 = (1..=10).sum();
    println!("Sum 1..=10 = {}", sum);
}
`
  },
  {
    id: 'ruby',
    label: 'Ruby',
    ext: 'rb',
    cmLang: 'rb',
    runtimeId: 'ruby',
    starter: `# Ruby — Press Ctrl+Enter or click Run
squares = (1..6).map { |n| n * n }
puts "Squares: #{squares.inspect}"
`
  },
  {
    id: 'php',
    label: 'PHP',
    ext: 'php',
    cmLang: 'php',
    runtimeId: 'php',
    starter: `<?php
$nums = range(1, 5);
echo "Sum: " . array_sum($nums) . PHP_EOL;
`
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    ext: 'ps1',
    cmLang: 'ps1',
    runtimeId: 'powershell',
    starter: `# PowerShell — Press Ctrl+Enter or click Run
$items = 1..5 | ForEach-Object { $_ * $_ }
Write-Output ("Squares: " + ($items -join ", "))
`
  },
  {
    id: 'bash',
    label: 'Bash / Shell',
    ext: 'sh',
    cmLang: 'bash',
    runtimeId: 'bash',
    starter: `#!/usr/bin/env bash
for i in 1 2 3 4; do
  echo "Step $i"
done
`
  },
  {
    id: 'lua',
    label: 'Lua',
    ext: 'lua',
    cmLang: 'lua',
    runtimeId: 'lua',
    starter: `-- Lua
for i = 1, 5 do
  print("i =", i, "i^2 =", i * i)
end
`
  },
  {
    id: 'perl',
    label: 'Perl',
    ext: 'pl',
    cmLang: 'pl',
    runtimeId: 'perl',
    starter: `# Perl
my @arr = (10, 20, 30);
print "Count: " . scalar(@arr) . "\\n";
`
  },
  {
    id: 'r',
    label: 'R',
    ext: 'R',
    cmLang: 'r',
    runtimeId: 'r',
    starter: `# R (Rscript)
vals <- c(2, 4, 6, 8, 10)
cat("Mean:", mean(vals), "\\n")
`
  },
  {
    id: 'csharp',
    label: 'C#',
    ext: 'cs',
    cmLang: 'cs',
    runtimeId: 'csharp',
    starter: `// C# (dotnet-script / csc)
using System;
class Program {
    static void Main() {
        Console.WriteLine("Hello from C#!");
    }
}
`
  }
]

const RUNNABLE_BY_ID = new Map(RUNNABLE_LANGUAGES.map((l) => [l.id, l]))

const RUNNABLE_ALIAS_TO_ID: Record<string, string> = {
  py: 'python',
  python3: 'python',
  js: 'javascript',
  jsx: 'javascript',
  node: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  'c++': 'cpp',
  cxx: 'cpp',
  rs: 'rust',
  rb: 'ruby',
  ps1: 'powershell',
  sh: 'bash',
  pl: 'perl',
  cs: 'csharp',
  htm: 'html'
}

function getRunnableLanguageDef(langId: string): RunnableLanguageDef | undefined {
  const lower = (langId || '').trim().toLowerCase()
  return RUNNABLE_BY_ID.get(lower) ?? RUNNABLE_BY_ID.get(RUNNABLE_ALIAS_TO_ID[lower] ?? '')
}

function getLanguageDisplayLabel(langId: string): string {
  const runnable = getRunnableLanguageDef(langId)
  if (runnable) return runnable.label
  return langId || 'text'
}

function getLanguageExtensionBadge(langId: string): string {
  const runnable = getRunnableLanguageDef(langId)
  if (runnable) return `.${runnable.ext}`
  return `.${langId || 'txt'}`
}

function resolveCodeMirrorExtension(langId: string): Extension | null {
  if (!cachedCmLangs) return null
  const { loadLanguage, langNames } = cachedCmLangs
  const runnable = getRunnableLanguageDef(langId)
  const target: string = runnable ? runnable.cmLang : langId
  try {
    if ((langNames as readonly string[]).includes(target)) {
      return loadLanguage(target as LanguageName)
    }
    const lower = target.toLowerCase()
    if ((langNames as readonly string[]).includes(lower)) {
      return loadLanguage(lower as LanguageName)
    }
  } catch {
    /* ignore missing language mode */
  }
  return null
}

function createDefaultCodeTab(language = 'python', index = 1): CodeTabItem {
  const runnable = getRunnableLanguageDef(language)
  const ext = runnable?.ext ?? (language || 'txt')
  const starter =
    runnable?.starter ?? `// ${language} snippet\n`
  return {
    id: `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: index === 1 && language === 'python' ? 'main.py' : `snippet_${index}.${ext}`,
    language: runnable?.id ?? language,
    code: starter,
    stdin: '',
    output: null
  }
}

function buildInitialStudioTabs(): { tabs: CodeTabItem[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(STUDIO_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs?: CodeTabItem[]; activeTabId?: string }
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const activeId = parsed.tabs.some((t) => t.id === parsed.activeTabId)
          ? (parsed.activeTabId as string)
          : parsed.tabs[0].id
        return { tabs: parsed.tabs, activeTabId: activeId }
      }
    }
  } catch {
    /* ignore storage error */
  }

  const pyTab = createDefaultCodeTab('python', 1)
  const jsTab: CodeTabItem = {
    ...createDefaultCodeTab('javascript', 2),
    title: 'app.js'
  }
  return { tabs: [pyTab, jsTab], activeTabId: pyTab.id }
}

function wrapHtmlForPreview(rawHtml: string, previewId: string): string {
  const hookScript = `<script>
(function() {
  var id = ${JSON.stringify(previewId)};
  function serialize(val) {
    if (typeof val === 'string') return val;
    try { return JSON.stringify(val, null, 2); } catch (e) { return String(val); }
  }
  ['log', 'info', 'warn', 'error'].forEach(function(level) {
    var orig = console[level];
    console[level] = function() {
      var args = Array.prototype.slice.call(arguments).map(serialize).join(' ');
      try { window.parent.postMessage({ type: 'vgb-code-iframe-log', previewId: id, level: level, text: args }, '*'); } catch (e) {}
      if (orig) orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(ev) {
    try { window.parent.postMessage({ type: 'vgb-code-iframe-log', previewId: id, level: 'error', text: ev.message || 'Script error' }, '*'); } catch (e) {}
  });
})();
</script>`

  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${hookScript}`)
  }
  return `<!doctype html><html><head><meta charset="utf-8" />${hookScript}</head><body>${rawHtml}</body></html>`
}

/* ------------------------------------------------------------------ */
/* Core Multi-Tab Code Runner Workspace (shared by Left Panel & Card) */
/* ------------------------------------------------------------------ */

export interface CodeFlowConnectionSummary {
  incomingCount: number
  outgoingCount: number
  incomingLabels?: string[]
  outgoingLabels?: string[]
}

export interface CodeRunnerWorkspaceProps {
  tabs: CodeTabItem[]
  activeTabId: string
  onChangeTabs: (tabs: CodeTabItem[], nextActiveTabId?: string) => void
  codeNodeId?: string
  linkedScene3DId?: string
  linkedGraphGroupId?: string
  connectionSummary?: CodeFlowConnectionSummary
  onExecuteCodeNode?: (cardId: string, tabId?: string) => Promise<void>
  onSpawnGraphFromCode?: (spec: GraphPlotSpec, sourceCardId?: string) => void
  onSpawnScene3DFromCode?: (spec: Scene3DSpec, sourceCardId?: string) => void
  isLightTheme?: boolean
  compact?: boolean
  onPinToBoard?: (tab: CodeTabItem) => void
  onSendOutputToNote?: (markdown: string, title?: string) => void
  onAskAI?: (ctx: {
    title: string
    language: string
    code: string
    stdout?: string
    stderr?: string
    error?: string
  }) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

export const CodeRunnerWorkspace: React.FC<CodeRunnerWorkspaceProps> = ({
  tabs,
  activeTabId,
  onChangeTabs,
  codeNodeId,
  linkedScene3DId,
  linkedGraphGroupId,
  connectionSummary,
  onExecuteCodeNode,
  onSpawnGraphFromCode,
  onSpawnScene3DFromCode,
  compact = false,
  onPinToBoard,
  onSendOutputToNote,
  onAskAI,
  onToast
}) => {
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  )

  const [isRunning, setIsRunning] = useState(false)
  const [showStdin, setShowStdin] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedOutput, setCopiedOutput] = useState(false)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabTitle, setEditingTabTitle] = useState('')
  const [langPickerOpen, setLangPickerOpen] = useState(false)
  const [langSearch, setLangSearch] = useState('')
  const [runtimes, setRuntimes] = useState<Record<string, CodeRuntimeInfo>>({})
  const [htmlPreviewTick, setHtmlPreviewTick] = useState(0)
  const [htmlLogs, setHtmlLogs] = useState<Array<{ level: string; text: string }>>([])
  const [outputHeightPct, setOutputHeightPct] = useState(38)
  const [cmLangsReady, setCmLangsReady] = useState<boolean>(() => Boolean(cachedCmLangs))

  useEffect(() => {
    if (cachedCmLangs) return
    let cancelled = false
    void loadCmLangsModule()
      .then(() => {
        if (!cancelled) setCmLangsReady(true)
      })
      .catch(() => {
        /* ignore dynamic load failure; editor remains usable */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const langPickerRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const previewInstanceId = useMemo(
    () => `preview-${activeTab?.id || 'default'}-${htmlPreviewTick}`,
    [activeTab?.id, htmlPreviewTick]
  )

  useEffect(() => {
    let cancelled = false
    window.glassAPI?.checkCodeRuntimes?.().then((res) => {
      if (!cancelled && res) setRuntimes(res)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!langPickerOpen) return
    const onOutside = (e: MouseEvent): void => {
      if (langPickerRef.current && !langPickerRef.current.contains(e.target as Node)) {
        setLangPickerOpen(false)
      }
    }
    window.addEventListener('mousedown', onOutside)
    return () => window.removeEventListener('mousedown', onOutside)
  }, [langPickerOpen])

  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (
        e.data &&
        e.data.type === 'vgb-code-iframe-log' &&
        e.data.previewId === previewInstanceId
      ) {
        setHtmlLogs((prev) => [
          ...prev.slice(-80),
          { level: String(e.data.level || 'log'), text: String(e.data.text || '') }
        ])
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [previewInstanceId])

  const updateTabById = useCallback(
    (tabId: string, patch: Partial<CodeTabItem>, nextActiveId?: string) => {
      const next = tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t))
      onChangeTabs(next, nextActiveId)
    },
    [tabs, onChangeTabs]
  )

  const handleAddTab = useCallback(() => {
    const nextIdx = tabs.length + 1
    const baseLang = activeTab?.language || 'python'
    const newTab = createDefaultCodeTab(baseLang, nextIdx)
    onChangeTabs([...tabs, newTab], newTab.id)
  }, [tabs, activeTab?.language, onChangeTabs])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) {
        const fresh = createDefaultCodeTab(tabs[0]?.language || 'python', 1)
        onChangeTabs([fresh], fresh.id)
        return
      }
      const idx = tabs.findIndex((t) => t.id === tabId)
      const next = tabs.filter((t) => t.id !== tabId)
      const nextActive =
        tabId === activeTab?.id
          ? next[Math.max(0, idx - 1)]?.id ?? next[0].id
          : activeTab?.id
      onChangeTabs(next, nextActive)
    },
    [tabs, activeTab?.id, onChangeTabs]
  )

  const handleSwitchLanguage = useCallback(
    (newLangId: string) => {
      const tab = activeTab
      if (!tab) return
      const prevRunnable = getRunnableLanguageDef(tab.language)
      const nextRunnable = getRunnableLanguageDef(newLangId)
      const nextExt = nextRunnable?.ext ?? newLangId

      const patch: Partial<CodeTabItem> = {
        language: nextRunnable?.id ?? newLangId
      }

      // If the user hasn't customized the starter template yet, swap to the new language's starter
      const isUnmodifiedStarter =
        !tab.code.trim() ||
        RUNNABLE_LANGUAGES.some((r) => r.starter.trim() === tab.code.trim()) ||
        tab.code.trim().startsWith(`// ${tab.language} snippet`)

      if (isUnmodifiedStarter) {
        patch.code = nextRunnable?.starter ?? `// ${newLangId} snippet\n`
      }

      // Auto-update generic filename extensions (e.g. main.py -> main.js or snippet_2.py -> snippet_2.cpp)
      if (prevRunnable && tab.title.endsWith(`.${prevRunnable.ext}`)) {
        patch.title = tab.title.slice(0, -prevRunnable.ext.length) + nextExt
      } else if (/^(main|app|snippet_\d+)\.[A-Za-z0-9_+]+$/.test(tab.title)) {
        patch.title = tab.title.replace(/\.[A-Za-z0-9_+]+$/, `.${nextExt}`)
      }

      updateTabById(tab.id, patch)
      setLangPickerOpen(false)
      setLangSearch('')
    },
    [activeTab, updateTabById]
  )

  const handleResetExample = useCallback(() => {
    const tab = activeTab
    if (!tab) return
    const runnable = getRunnableLanguageDef(tab.language)
    updateTabById(tab.id, {
      code: runnable?.starter ?? `// ${tab.language} snippet\n`,
      output: null
    })
  }, [activeTab, updateTabById])

  const syncLinkedVisualsForStdout = useCallback(
    (stdout: string, title: string) => {
      if (!stdout.trim()) return
      const visuals = parseCodeOutputToVisuals(stdout, title)
      if (linkedScene3DId && visuals.scene3d && onSpawnScene3DFromCode) {
        onSpawnScene3DFromCode(visuals.scene3d, codeNodeId)
      }
      if (linkedGraphGroupId && visuals.plot2d && onSpawnGraphFromCode) {
        onSpawnGraphFromCode(visuals.plot2d, codeNodeId)
      }
    },
    [linkedScene3DId, linkedGraphGroupId, onSpawnScene3DFromCode, onSpawnGraphFromCode, codeNodeId]
  )

  const handleRunCode = useCallback(async () => {
    const tab = activeTab
    if (!tab || isRunning) return

    const lang = tab.language.toLowerCase()
    if (lang === 'html' || lang === 'htm') {
      setHtmlLogs([])
      setHtmlPreviewTick((t) => t + 1)
      const out: CodeTabExecutionOutput = {
        ok: true,
        stdout: 'Live HTML preview updated.',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        language: 'html',
        command: 'sandboxed iframe preview',
        timestamp: Date.now()
      }
      updateTabById(tab.id, { output: out })
      return
    }

    if (codeNodeId && onExecuteCodeNode) {
      setIsRunning(true)
      try {
        await onExecuteCodeNode(codeNodeId, tab.id)
      } catch (err) {
        onToast?.('error', err instanceof Error ? err.message : String(err))
      } finally {
        setIsRunning(false)
      }
      return
    }

    const api = window.glassAPI
    if (!api?.runCode) {
      updateTabById(tab.id, {
        output: {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: 0,
          language: tab.language,
          error: 'Local code execution bridge (window.glassAPI.runCode) is only available inside the Electron app.',
          timestamp: Date.now()
        }
      })
      return
    }

    setIsRunning(true)
    try {
      const res = await api.runCode({
        language: tab.language,
        code: wrapCodeForAutoOutput(tab.language, tab.code),
        stdin: tab.stdin ?? '',
        timeoutMs: 12000,
        filename: tab.title
      })
      const nextOutput: CodeTabExecutionOutput = {
        ...res,
        timestamp: Date.now()
      }
      const parsed = res.stdout ? parseCodeOutputToVisuals(res.stdout, tab.title) : null
      const nextVisualMode =
        tab.visualMode ??
        (parsed?.detectedKind === 'scene3d'
          ? 'scene3d'
          : parsed?.detectedKind === 'plot2d'
            ? 'plot2d'
            : 'terminal')
      updateTabById(tab.id, {
        output: nextOutput,
        visualMode: nextVisualMode
      })
      if (res.ok && res.stdout) {
        syncLinkedVisualsForStdout(res.stdout, tab.title)
      }
    } catch (err) {
      updateTabById(tab.id, {
        output: {
          ok: false,
          stdout: '',
          stderr: '',
          exitCode: null,
          durationMs: 0,
          language: tab.language,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now()
        }
      })
    } finally {
      setIsRunning(false)
    }
  }, [activeTab, isRunning, codeNodeId, onExecuteCodeNode, onToast, updateTabById, syncLinkedVisualsForStdout])

  const editorExtensions = useMemo(() => {
    const exts: Extension[] = [EditorView.lineWrapping]
    const langExt = cmLangsReady ? resolveCodeMirrorExtension(activeTab?.language || 'python') : null
    if (langExt) exts.unshift(langExt)
    return exts
  }, [activeTab?.language, cmLangsReady])

  const filteredRunnable = useMemo(() => {
    const q = langSearch.trim().toLowerCase()
    if (!q) return RUNNABLE_LANGUAGES
    return RUNNABLE_LANGUAGES.filter(
      (l) =>
        l.label.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q) ||
        l.ext.toLowerCase().includes(q)
    )
  }, [langSearch])

  const filteredOtherLangs = useMemo(() => {
    const q = langSearch.trim().toLowerCase()
    const runnableCmSet = new Set<string>(RUNNABLE_LANGUAGES.map((l) => l.cmLang))
    const sourceList = (cachedCmLangs?.langNames as readonly string[] | undefined) ?? CM_LANG_NAMES
    const all = sourceList
      .filter((name) => !runnableCmSet.has(name) && !getRunnableLanguageDef(name))
      .sort((a, b) => a.localeCompare(b))
    if (!q) return all
    return all.filter((name) => name.toLowerCase().includes(q))
  }, [langSearch, cmLangsReady])

  const handleCopyCode = async (): Promise<void> => {
    if (!activeTab) return
    try {
      await navigator.clipboard.writeText(activeTab.code)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 1600)
    } catch {
      onToast?.('error', 'Failed to copy code')
    }
  }

  const handleCopyOutput = async (): Promise<void> => {
    if (!activeTab?.output) return
    const text = [activeTab.output.stdout, activeTab.output.stderr, activeTab.output.error]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text || '')
      setCopiedOutput(true)
      setTimeout(() => setCopiedOutput(false), 1600)
    } catch {
      onToast?.('error', 'Failed to copy output')
    }
  }

  const handleSendToNote = (): void => {
    if (!activeTab || !onSendOutputToNote) return
    const out = activeTab.output
    const visuals = out?.stdout ? parseCodeOutputToVisuals(out.stdout, activeTab.title) : null
    const visualBlock = visuals?.scene3d
      ? `\`\`\`3d\n${JSON.stringify(visuals.scene3d, null, 2)}\n\`\`\``
      : ''
    const resultBlock = out
      ? [
        out.stdout?.trim() && !visualBlock ? `**Output:**\n\`\`\`text\n${out.stdout.trim()}\n\`\`\`` : '',
        out.stderr?.trim() ? `**Stderr:**\n\`\`\`text\n${out.stderr.trim()}\n\`\`\`` : '',
        out.error?.trim() ? `**Error:**\n\`\`\`text\n${out.error.trim()}\n\`\`\`` : ''
      ]
        .filter(Boolean)
        .join('\n\n')
      : ''

    const md = [
      `\`\`\`${activeTab.language}\n${activeTab.code.trimEnd()}\n\`\`\``,
      visualBlock,
      resultBlock
    ]
      .filter(Boolean)
      .join('\n\n')

    onSendOutputToNote(md, activeTab.title)
  }

  const handleStartSplitResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const startY = e.clientY
      const startPct = outputHeightPct
      const totalH = Math.max(220, workspaceRef.current?.getBoundingClientRect().height || 400)

      const onMove = (moveEvt: PointerEvent): void => {
        const deltaY = moveEvt.clientY - startY
        const nextPct = Math.round(startPct - (deltaY / totalH) * 100)
        setOutputHeightPct(Math.max(18, Math.min(72, nextPct)))
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [outputHeightPct]
  )

  const parsedVisuals = useMemo(
    () =>
      activeTab?.output?.stdout
        ? parseCodeOutputToVisuals(activeTab.output.stdout, activeTab.title)
        : { plot2d: null, scene3d: null, detectedKind: null },
    [activeTab]
  )

  if (!activeTab) return null

  const activeRunnable = getRunnableLanguageDef(activeTab.language)
  const runtimeInfo = activeRunnable ? runtimes[activeRunnable.runtimeId] : undefined
  const isHtmlMode = activeTab.language.toLowerCase() === 'html' || activeTab.language.toLowerCase() === 'htm'
  const out = activeTab.output
  const hasOutputContent = Boolean(out?.stdout || out?.stderr || out?.error)
  const outputViewMode: 'terminal' | 'plot2d' | 'scene3d' =
    activeTab.visualMode === 'scene3d' && parsedVisuals.scene3d
      ? 'scene3d'
      : activeTab.visualMode === 'plot2d' && parsedVisuals.plot2d
        ? 'plot2d'
        : 'terminal'

  return (
    <div
      ref={workspaceRef}
      className={`code-workspace ${compact ? 'is-compact' : ''}`}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      {/* 1. Multi-tab strip */}
      <div className="code-tabs-bar" role="tablist" aria-label="Coding tabs">
        <div className="code-tabs-scroll">
          {tabs.map((tab) => {
            const isTabActive = tab.id === activeTab.id
            const isEditing = editingTabId === tab.id
            const extBadge = getLanguageExtensionBadge(tab.language)
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isTabActive}
                className={`code-tab-pill ${isTabActive ? 'active' : ''}`}
                style={getReadableTabStyle(tab.color, {
                  isActive: isTabActive,
                  subtleInactive: true
                })}
                onClick={() => onChangeTabs(tabs, tab.id)}
                onDoubleClick={() => {
                  setEditingTabId(tab.id)
                  setEditingTabTitle(tab.title)
                }}
                title={`${tab.title} (${getLanguageDisplayLabel(tab.language)}) — Double-click to rename`}
              >
                <span className="code-tab-ext">{extBadge}</span>
                {isEditing ? (
                  <input
                    type="text"
                    className="code-tab-rename-input"
                    value={editingTabTitle}
                    onChange={(e) => setEditingTabTitle(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => {
                      const trimmed = editingTabTitle.trim()
                      if (trimmed) updateTabById(tab.id, { title: trimmed })
                      setEditingTabId(null)
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') {
                        const trimmed = editingTabTitle.trim()
                        if (trimmed) updateTabById(tab.id, { title: trimmed })
                        setEditingTabId(null)
                      } else if (e.key === 'Escape') {
                        setEditingTabId(null)
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <span className="code-tab-name">{tab.title}</span>
                )}
                <TabColorPicker
                  size="xs"
                  color={tab.color}
                  onChange={(c) => updateTabById(tab.id, { color: c })}
                  title={`Change "${tab.title}" tab color`}
                />
                <button
                  type="button"
                  className="code-tab-close"
                  title={tabs.length > 1 ? 'Close tab' : 'Reset tab'}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tab.id)
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>

        <button
          type="button"
          className="code-tab-add-btn"
          title="Add new coding tab"
          onClick={handleAddTab}
        >
          <Plus size={13} />
          {!compact && <span>New Tab</span>}
        </button>
      </div>

      {/* 2. Action Toolbar */}
      <div className="code-toolbar">
        {/* Searchable Language Picker */}
        <div className="code-lang-picker-wrap" ref={langPickerRef}>
          <button
            type="button"
            className="code-lang-btn"
            onClick={() => setLangPickerOpen((o) => !o)}
            title="Select programming language (100+ languages supported via CodeMirror 6)"
          >
            {isHtmlMode ? (
              <span className="runtime-dot available" title="Live browser preview" />
            ) : activeRunnable ? (
              <span
                className={`runtime-dot ${runtimeInfo ? (runtimeInfo.available ? 'available' : 'missing') : 'unknown'
                  }`}
                title={
                  runtimeInfo
                    ? runtimeInfo.available
                      ? `Local runtime ready: ${runtimeInfo.version || runtimeInfo.command}`
                      : `Local runtime "${runtimeInfo.command}" not found on PATH`
                    : 'Local runner supported'
                }
              />
            ) : (
              <span className="runtime-dot syntax" title="Syntax highlighting mode" />
            )}
            <span className="code-lang-btn-label">{getLanguageDisplayLabel(activeTab.language)}</span>
            <ChevronDown size={12} />
          </button>

          {langPickerOpen && (
            <div className="code-lang-popover" onPointerDown={(e) => e.stopPropagation()}>
              <div className="code-lang-search-wrap">
                <Search size={12} className="code-lang-search-icon" />
                <input
                  type="text"
                  className="code-lang-search-input"
                  placeholder={`Search ${RUNNABLE_LANGUAGES.length} runnable + ${((cachedCmLangs?.langNames.length ?? CM_LANG_NAMES.length))}+ languages...`}
                  value={langSearch}
                  onChange={(e) => setLangSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  autoFocus
                />
                {langSearch && (
                  <button
                    type="button"
                    className="code-lang-search-clear"
                    onClick={() => setLangSearch('')}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              <div className="code-lang-list">
                {filteredRunnable.length > 0 && (
                  <>
                    <div className="code-lang-group-label">Runnable Locally / Live</div>
                    {filteredRunnable.map((lang) => {
                      const info = runtimes[lang.runtimeId]
                      const selected = activeTab.language === lang.id
                      return (
                        <button
                          key={lang.id}
                          type="button"
                          className={`code-lang-option ${selected ? 'active' : ''}`}
                          onClick={() => handleSwitchLanguage(lang.id)}
                        >
                          <span
                            className={`runtime-dot ${lang.runtimeId === 'browser'
                              ? 'available'
                              : info
                                ? info.available
                                  ? 'available'
                                  : 'missing'
                                : 'unknown'
                              }`}
                          />
                          <span className="code-lang-option-name">{lang.label}</span>
                          <span className="code-lang-option-meta">
                            {lang.runtimeId === 'browser'
                              ? 'Live'
                              : info?.available
                                ? info.command
                                : `.${lang.ext}`}
                          </span>
                        </button>
                      )
                    })}
                  </>
                )}

                {filteredOtherLangs.length > 0 && (
                  <>
                    <div className="code-lang-group-label">
                      All CodeMirror Languages ({filteredOtherLangs.length})
                    </div>
                    {filteredOtherLangs.map((langName) => {
                      const selected = activeTab.language === langName
                      return (
                        <button
                          key={langName}
                          type="button"
                          className={`code-lang-option ${selected ? 'active' : ''}`}
                          onClick={() => handleSwitchLanguage(langName)}
                        >
                          <span className="runtime-dot syntax" />
                          <span className="code-lang-option-name">{langName}</span>
                          <span className="code-lang-option-meta">syntax</span>
                        </button>
                      )
                    })}
                  </>
                )}

                {filteredRunnable.length === 0 && filteredOtherLangs.length === 0 && (
                  <div className="code-lang-empty">No matching language found.</div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="code-toolbar-actions">
          <button
            type="button"
            className="code-tool-btn"
            onClick={handleResetExample}
            title="Load starter example snippet for this language"
          >
            <RotateCcw size={12} />
          </button>

          {!isHtmlMode && (
            <button
              type="button"
              className={`code-tool-btn ${showStdin || activeTab.stdin ? 'active' : ''}`}
              onClick={() => setShowStdin((s) => !s)}
              title="Toggle standard input (stdin) drawer"
            >
              <SlidersHorizontal size={12} />
              {!compact && <span>Stdin</span>}
            </button>
          )}

          {!isHtmlMode && (
            <button
              type="button"
              className={`code-tool-btn ${showGuide ? 'active' : ''}`}
              onClick={() => setShowGuide((g) => !g)}
              title="How to build Code Pipelines & Plot Graphs"
            >
              <HelpCircle size={12} />
              {!compact && <span>Guide</span>}
            </button>
          )}

          <button
            type="button"
            className="code-tool-btn"
            onClick={handleCopyCode}
            title="Copy code snippet"
          >
            {copiedCode ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          </button>

          {onPinToBoard && (
            <button
              type="button"
              className="code-tool-btn"
              onClick={() => onPinToBoard(activeTab)}
              title="Pin this code tab onto the whiteboard as a movable Code Card"
            >
              <Pin size={12} />
              {!compact && <span>Pin</span>}
            </button>
          )}

          {onAskAI && (
            <button
              type="button"
              className={`code-ai-btn ${out && !out.ok ? 'is-fix' : ''}`}
              onClick={() =>
                onAskAI({
                  title: activeTab.title,
                  language: activeTab.language,
                  code: activeTab.code,
                  stdout: out?.stdout,
                  stderr: out?.stderr,
                  error: out?.error
                })
              }
              title={
                out && !out.ok
                  ? 'Ask VexelBot Agent to diagnose & fix this error'
                  : 'Ask VexelBot Agent to explain or improve this code'
              }
            >
              <Sparkles size={12} />
              {!compact && <span>{out && !out.ok ? 'AI Fix' : 'AI Assist'}</span>}
            </button>
          )}

          <button
            type="button"
            className={`code-run-btn ${isRunning ? 'running' : ''}`}
            disabled={isRunning}
            onClick={() => void handleRunCode()}
            title={isHtmlMode ? 'Render Live Preview (Ctrl+Enter)' : 'Run Snippet Locally (Ctrl+Enter)'}
          >
            {isRunning ? (
              <>
                <Loader2 size={13} className="spin-animate" />
                <span>Running</span>
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" />
                <span>{isHtmlMode ? 'Preview' : 'Run'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline Code Pipeline & Graph Guide */}
      {showGuide && (
        <div
          className="code-pipeline-guide"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="code-pipeline-guide-hdr">
            <span>How to Build a Processing Pipeline &amp; Graph</span>
            <button
              type="button"
              className="code-mini-clear-btn"
              onClick={() => setShowGuide(false)}
            >
              Close
            </button>
          </div>
          <div className="code-guide-steps">
            <div className="code-guide-step">
              <strong>1. Generate Data (Card 1)</strong>
              <p>
                Assign <code>x = [...]</code>, <code>y = [...]</code> or return a{' '}
                <code>{`{"x": ..., "y": ...}`}</code> dict. No <code>print</code> needed.
              </p>
              <button
                type="button"
                className="code-guide-chip-btn"
                onClick={() => {
                  updateTabById(activeTab.id, {
                    language: 'python',
                    code: `import math\n\n# Stage 1: Generate raw data (returned dict goes to connected cards)\nx = [round(i * 0.25, 2) for i in range(0, 36)]\nraw_y = [round(math.sin(v) * 10 + ((i % 4) - 1.5) * 2, 2) for i, v in enumerate(x)]\n\n{"title": "Stage 1 Raw Signal", "x": x, "raw_y": raw_y, "y": raw_y}\n`
                  })
                  onToast?.('info', 'Loaded Stage 1 template — press Run!')
                }}
              >
                Load Stage 1 Template
              </button>
            </div>

            <div className="code-guide-step">
              <strong>2. Connect &amp; Process (Card 2)</strong>
              <p>
                Click or drag the right <b>cyan dot</b> to link Card 2. Write{' '}
                <code>def transform(data):</code> to get Card 1&apos;s dict automatically.
              </p>
              <button
                type="button"
                className="code-guide-chip-btn"
                onClick={() => {
                  updateTabById(activeTab.id, {
                    language: 'python',
                    code: `# Stage 2: 'data' receives Card 1's output dict automatically!\ndef transform(data):\n    x = data.get("x", [1, 2, 3, 4, 5])\n    raw = data.get("raw_y") or data.get("y") or [1, 3, 2, 5, 4]\n    smooth = [\n        round(sum(raw[max(0, i - 1):i + 2]) / len(raw[max(0, i - 1):i + 2]), 2)\n        for i in range(len(raw))\n    ]\n    return {\n        "type": "line",\n        "title": "Raw vs. Smoothed Signal",\n        "x": x,\n        "series": [\n            {"label": "Raw", "y": raw, "color": "#94A3B8"},\n            {"label": "Smoothed", "y": smooth, "color": "#2563EB"}\n        ]\n    }\n`
                  })
                  onToast?.('info', 'Loaded Stage 2 template — connect & press Run!')
                }}
              >
                Load Stage 2 Template
              </button>
            </div>

            <div className="code-guide-step">
              <strong>3. Plot 2D / 3D Graph</strong>
              <p>
                Click <b>+ 2D Board</b> in output (or drag a connector dot to any Graph Card). Supports{' '}
                <code>bar</code>, <code>histogram</code>, <code>candlestick</code>, <code>scatter3d</code>.
              </p>
              <button
                type="button"
                className="code-guide-chip-btn"
                onClick={() => {
                  updateTabById(activeTab.id, {
                    language: 'python',
                    code: `# Multi-chart / 3D plot hashmap example — switch chart types anytime on the Graph!\nx = [round(i * 0.3, 2) for i in range(-10, 11)]\nreturn {\n    "type": "line",\n    "title": "Quadratic Comparison",\n    "x": x,\n    "series": [\n        {"label": "0.5x^2", "y": [round(0.5 * v * v, 2) for v in x], "color": "#2563EB"},\n        {"label": "2x + 4", "y": [round(2 * v + 4, 2) for v in x], "color": "#10B981"}\n    ]\n}\n`
                  })
                  onToast?.('info', 'Loaded Multi-Series Plot — press Run!')
                }}
              >
                Load Multi-Series Plot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. CodeMirror 6 Editor */}
      <div
        className="code-editor-container"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault()
            e.stopPropagation()
            void handleRunCode()
          }
        }}
      >
        <CodeMirror
          value={activeTab.code}
          height="100%"
          theme="light"
          extensions={editorExtensions}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            foldGutter: true,
            autocompletion: true,
            bracketMatching: true,
            closeBrackets: true,
            indentOnInput: true,
            highlightSelectionMatches: true
          }}
          onChange={(val) => updateTabById(activeTab.id, { code: val })}
        />
      </div>

      {/* 4. Optional Stdin Drawer */}
      {showStdin && !isHtmlMode && (
        <div className="code-stdin-drawer">
          <div className="code-stdin-label">
            <span>
              Standard Input (stdin)
              {connectionSummary && connectionSummary.incomingCount > 0
                ? ` — Connected input (${connectionSummary.incomingCount})`
                : ''}
            </span>
            {activeTab.stdin && (
              <button
                type="button"
                className="code-mini-clear-btn"
                onClick={() => updateTabById(activeTab.id, { stdin: '' })}
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            className="code-stdin-textarea"
            rows={2}
            placeholder={
              connectionSummary && connectionSummary.incomingCount > 0
                ? 'Auto-piped from upstream connected card stdout on Run...'
                : 'Optional input lines piped to stdin...'
            }
            value={activeTab.stdin ?? ''}
            onChange={(e) => updateTabById(activeTab.id, { stdin: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* 5. Draggable Editor / Output Split Handle */}
      <div
        className="code-split-resizer"
        onPointerDown={handleStartSplitResize}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setOutputHeightPct(38)
        }}
        title="Drag up/down to resize Editor vs Output (Double-click to reset)"
      >
        <span className="code-split-resizer-bar" />
      </div>

      {/* 6. Execution Result Showcase / 2D Graph / 3D Sim / Live HTML Preview */}
      <div
        className="code-output-panel"
        style={{ flex: `0 0 ${outputHeightPct}%`, maxHeight: '72%' }}
      >
        <div className="code-output-header">
          <div className="code-output-status-group">
            {isHtmlMode ? (
              <span className="code-status-badge ok">
                <Globe size={11} />
                <span>Live HTML Sandbox</span>
              </span>
            ) : isRunning ? (
              <span className="code-status-badge running">
                <Loader2 size={11} className="spin-animate" />
                <span>Executing...</span>
              </span>
            ) : out ? (
              <span className={`code-status-badge ${out.ok ? 'ok' : 'err'}`}>
                {out.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                <span>
                  {out.timedOut
                    ? 'Timed Out'
                    : out.ok
                      ? `Exit ${out.exitCode ?? 0}`
                      : out.exitCode !== null
                        ? `Exit ${out.exitCode}`
                        : 'Error'}
                </span>
              </span>
            ) : (
              <span className="code-status-badge idle">
                <Terminal size={11} />
                <span>Output</span>
              </span>
            )}

            {connectionSummary &&
              (connectionSummary.incomingCount > 0 || connectionSummary.outgoingCount > 0) && (
                <span
                  className="code-flow-link-badge"
                  title="Flowchart connectors link this Code Card's stdin/stdout to other Code Cards, 2D Graphs, and 3D Scenes"
                >
                  {connectionSummary.incomingCount > 0 ? `← ${connectionSummary.incomingCount} in` : ''}
                  {connectionSummary.incomingCount > 0 && connectionSummary.outgoingCount > 0 ? ' · ' : ''}
                  {connectionSummary.outgoingCount > 0 ? `${connectionSummary.outgoingCount} out →` : ''}
                </span>
              )}

            {out && !isRunning && (
              <span className="code-duration-pill" title={out.command || ''}>
                <Clock size={10} />
                <span>{out.durationMs}ms</span>
              </span>
            )}

            {/* Output View Mode Switcher: Terminal | 2D Graph | 3D Sim */}
            {(parsedVisuals.plot2d || parsedVisuals.scene3d) && (
              <div className="code-out-view-pills">
                <button
                  type="button"
                  className={`code-out-view-pill ${outputViewMode === 'terminal' ? 'active' : ''}`}
                  onClick={() => updateTabById(activeTab.id, { visualMode: 'terminal' })}
                >
                  Text
                </button>
                {parsedVisuals.plot2d && (
                  <button
                    type="button"
                    className={`code-out-view-pill ${outputViewMode === 'plot2d' ? 'active' : ''}`}
                    onClick={() => updateTabById(activeTab.id, { visualMode: 'plot2d' })}
                  >
                    <LineChart size={10} />
                    <span>2D</span>
                  </button>
                )}
                {parsedVisuals.scene3d && (
                  <button
                    type="button"
                    className={`code-out-view-pill ${outputViewMode === 'scene3d' ? 'active' : ''}`}
                    onClick={() => updateTabById(activeTab.id, { visualMode: 'scene3d' })}
                  >
                    <Box size={10} />
                    <span>3D</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="code-output-actions">
            {parsedVisuals.plot2d && onSpawnGraphFromCode && (
              <button
                type="button"
                className="code-out-btn visual-spawn"
                onClick={() => onSpawnGraphFromCode(parsedVisuals.plot2d!, codeNodeId)}
                title={
                  linkedGraphGroupId
                    ? 'Update linked 2D Graph on whiteboard'
                    : 'Draw & link 2D Graph onto the whiteboard canvas'
                }
              >
                <LineChart size={11} />
                <span>{linkedGraphGroupId ? 'Sync 2D' : '+ 2D Board'}</span>
              </button>
            )}
            {parsedVisuals.scene3d && onSpawnScene3DFromCode && (
              <button
                type="button"
                className="code-out-btn visual-spawn"
                onClick={() => onSpawnScene3DFromCode(parsedVisuals.scene3d!, codeNodeId)}
                title={
                  linkedScene3DId
                    ? 'Update linked 3D Simulation on whiteboard'
                    : 'Immerse & link 3D Object onto the whiteboard canvas'
                }
              >
                <Box size={11} />
                <span>{linkedScene3DId ? 'Sync 3D' : '+ 3D Board'}</span>
              </button>
            )}
            {onSendOutputToNote && (activeTab.code.trim() || hasOutputContent) && (
              <button
                type="button"
                className="code-out-btn"
                onClick={handleSendToNote}
                title="Insert snippet & output onto the board as a formatted Note"
              >
                <FilePlus2 size={11} />
                <span>+ Note</span>
              </button>
            )}
            {hasOutputContent && (
              <button
                type="button"
                className="code-out-btn"
                onClick={handleCopyOutput}
                title="Copy output"
              >
                {copiedOutput ? <Check size={11} /> : <Copy size={11} />}
              </button>
            )}
            {(out || htmlLogs.length > 0) && (
              <button
                type="button"
                className="code-out-btn"
                onClick={() => {
                  setHtmlLogs([])
                  updateTabById(activeTab.id, { output: null })
                }}
                title="Clear output"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        </div>

        <div className="code-output-body">
          {isHtmlMode ? (
            <div className="code-html-preview-wrap">
              <iframe
                key={previewInstanceId}
                title={`HTML Preview ${activeTab.title}`}
                className="code-html-preview-frame"
                sandbox="allow-scripts"
                srcDoc={wrapHtmlForPreview(activeTab.code, previewInstanceId)}
              />
              {htmlLogs.length > 0 && (
                <div className="code-html-console">
                  {htmlLogs.map((log, i) => (
                    <div key={i} className={`code-html-log-line level-${log.level}`}>
                      <span className="log-prefix">[{log.level}]</span> {log.text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : outputViewMode === 'scene3d' && parsedVisuals.scene3d ? (
            <div className="code-visual-out-wrap">
              <Inline3DViewer
                spec={parsedVisuals.scene3d}
                height={185}
                onImmerseOnBoard={
                  onSpawnScene3DFromCode
                    ? (spec) => onSpawnScene3DFromCode(spec, codeNodeId)
                    : undefined
                }
                compact={compact}
              />
            </div>
          ) : outputViewMode === 'plot2d' && parsedVisuals.plot2d ? (
            <div className="code-visual-out-wrap">
              <InteractiveGraphViewport
                spec={parsedVisuals.plot2d}
                height={188}
                compact={compact}
                interactive
              />
            </div>
          ) : !out ? (
            <div className="code-output-placeholder">
              {activeRunnable
                ? `Press Run (Ctrl+Enter) or drag a board connector dot to link Code Cards, 2D Graphs & 3D Scenes.`
                : `Syntax highlighting active for "${activeTab.language}". Select a runnable language to execute locally.`}
            </div>
          ) : (
            <div className="code-terminal-output">
              {out.error && <pre className="code-out-error">{out.error}</pre>}
              {out.stdout && <pre className="code-out-stdout">{out.stdout}</pre>}
              {out.stderr && <pre className="code-out-stderr">{out.stderr}</pre>}
              {!out.error && !out.stdout && !out.stderr && (
                <div className="code-output-placeholder">
                  Program finished with exit code {out.exitCode ?? 0} (no output printed).
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Left Panel Flyout Studio (Persisted in localStorage)               */
/* ------------------------------------------------------------------ */

export interface CodeStudioPanelProps {
  flyoutRef?: React.RefObject<HTMLDivElement | null>
  isLightTheme?: boolean
  onClose: () => void
  onPinToBoard?: (tab: CodeTabItem) => void
  onSendOutputToNote?: (markdown: string, title?: string) => void
  onSpawnGraphFromCode?: (spec: GraphPlotSpec, sourceCardId?: string) => void
  onSpawnScene3DFromCode?: (spec: Scene3DSpec, sourceCardId?: string) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

export const CodeStudioPanel: React.FC<CodeStudioPanelProps> = ({
  flyoutRef,
  isLightTheme: _isLightTheme = false,
  onClose,
  onPinToBoard,
  onSendOutputToNote,
  onSpawnGraphFromCode,
  onSpawnScene3DFromCode,
  onToast
}) => {
  const [studioState, setStudioState] = useState<{ tabs: CodeTabItem[]; activeTabId: string }>(
    buildInitialStudioTabs
  )
  const [isExpanded, setIsExpanded] = useState(false)

  const handleChangeTabs = useCallback((tabs: CodeTabItem[], nextActiveTabId?: string) => {
    setStudioState((prev) => {
      const activeId = nextActiveTabId ?? prev.activeTabId
      const resolvedActive = tabs.some((t) => t.id === activeId) ? activeId : tabs[0]?.id ?? ''
      return { tabs, activeTabId: resolvedActive }
    })
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(studioState))
      } catch {
        /* ignore quota errors */
      }
    }, 350)
    return () => window.clearTimeout(t)
  }, [studioState])

  return (
    <div
      ref={flyoutRef}
      className={`vx-flyout-panel code-studio-panel ${isExpanded ? 'is-expanded' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="vx-flyout-header">
        <div className="vx-flyout-title">
          <Code2 size={14} />
          <span>Code Runner Studio</span>
          <span className="vx-count-pill">{studioState.tabs.length} tab{studioState.tabs.length > 1 ? 's' : ''}</span>
        </div>
        <div className="code-studio-header-actions">
          <button
            type="button"
            className="vx-flyout-close-btn"
            title={isExpanded ? 'Compact width' : 'Expand coding panel'}
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            className="vx-flyout-close-btn"
            title="Close Coding Studio"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <CodeRunnerWorkspace
        tabs={studioState.tabs}
        activeTabId={studioState.activeTabId}
        onChangeTabs={handleChangeTabs}
        isLightTheme={_isLightTheme}
        onPinToBoard={onPinToBoard}
        onSendOutputToNote={onSendOutputToNote}
        onSpawnGraphFromCode={onSpawnGraphFromCode}
        onSpawnScene3DFromCode={onSpawnScene3DFromCode}
        onToast={onToast}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Whiteboard Movable & Resizable Code Card                           */
/* ------------------------------------------------------------------ */

export interface CanvasCodeCardProps {
  node: CodeNode
  connectionSummary?: CodeFlowConnectionSummary
  isSelected: boolean
  isResizing?: boolean
  isLightTheme?: boolean
  disabledPointerEvents?: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<CodeNode>, opts?: { history?: boolean }) => void
  onDelete: () => void
  onDuplicate: () => void
  onAddContainer?: () => void
  onStartConnect?: (sourceId: string, port: PortSide, clientX: number, clientY: number) => void
  onExecuteCodeNode?: (cardId: string, tabId?: string) => Promise<void>
  onStartMove: (startX: number, startY: number) => void
  onStartResize?: (e: React.PointerEvent, dir: ResizeDirection) => void
  onSendOutputToNote?: (markdown: string, title?: string) => void
  onSpawnGraphFromCode?: (spec: GraphPlotSpec, sourceCardId?: string) => void
  onSpawnScene3DFromCode?: (spec: Scene3DSpec, sourceCardId?: string) => void
  onAskAI?: (ctx: {
    title: string
    language: string
    code: string
    stdout?: string
    stderr?: string
    error?: string
  }) => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

export const CanvasCodeCard: React.FC<CanvasCodeCardProps> = ({
  node,
  connectionSummary,
  isSelected,
  isResizing = false,
  isLightTheme: _isLightTheme = false,
  disabledPointerEvents = false,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onAddContainer,
  onStartConnect,
  onExecuteCodeNode,
  onStartMove,
  onStartResize,
  onSendOutputToNote,
  onSpawnGraphFromCode,
  onSpawnScene3DFromCode,
  onAskAI,
  onToast
}) => {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(node.title || 'Code Snippet')

  return (
    <div
      id={node.id}
      className={`canvas-code-card ${isSelected ? 'selected' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.w}px`,
        height: `${node.h}px`,
        pointerEvents: disabledPointerEvents ? 'none' : 'auto'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={(e) => {
        if (disabledPointerEvents) return
        e.stopPropagation()
        onSelect()
        const targetEl = e.target as HTMLElement | null
        const isInteractiveChild = Boolean(
          targetEl?.closest(
            '.cm-editor, .code-output-body, .code-stdin-textarea, .code-lang-popover, .code-split-resizer, .card-flow-port-handle, .inline-3d-viewer, .card-resize-handles, .resize-edge, .resize-handle, .resize-corner-grip, button, input, textarea, select'
          )
        )
        if (!isInteractiveChild && e.button === 0) {
          onStartMove(e.clientX, e.clientY)
        }
      }}
    >
      {/* Card Header (Move Pill + Title + Tab Color + Add Container / Duplicate / Delete) */}
      <div
        className="canvas-code-card-header"
        style={getReadableTabStyle(node.color)}
        title="Drag anywhere on header to move Coding Tab container"
      >
        <div className="canvas-code-card-drag">
          <span className="code-card-move-pill" title="Drag to move container">
            <GripHorizontal size={13} />
            <span>Move</span>
          </span>
          <Code2 size={13} className="text-accent" />
          {isEditingTitle ? (
            <input
              type="text"
              className="canvas-code-title-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false)
                onUpdate({ title: titleDraft.trim() || 'Code Snippet' })
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  setIsEditingTitle(false)
                  onUpdate({ title: titleDraft.trim() || 'Code Snippet' })
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="canvas-code-card-title"
              title="Double-click to rename container"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setTitleDraft(node.title || 'Code Snippet')
                setIsEditingTitle(true)
              }}
            >
              {node.title || 'Code Snippet'}
            </span>
          )}
        </div>

        <div className="canvas-code-card-actions" onPointerDown={(e) => e.stopPropagation()}>
          <TabColorPicker
            size="sm"
            color={node.color}
            onChange={(c) => onUpdate({ color: c })}
            title="Change Coding container header color"
          />
          {onAddContainer && (
            <button
              type="button"
              className="canvas-code-hdr-btn"
              title="Add another Coding Tab container on screen"
              onClick={onAddContainer}
            >
              <Plus size={12} />
            </button>
          )}
          <button
            type="button"
            className="canvas-code-hdr-btn"
            title="Duplicate Coding Container"
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="canvas-code-hdr-btn danger"
            title="Delete Coding Container"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Live dimension badge while resizing */}
      {isResizing && (
        <div className="resize-dimension-badge">
          {node.w} × {node.h} px
        </div>
      )}

      {/* Embedded Multi-Tab CodeMirror + Runner */}
      <div className="canvas-code-card-body">
        <CodeRunnerWorkspace
          tabs={node.tabs}
          activeTabId={node.activeTabId}
          codeNodeId={node.id}
          linkedScene3DId={node.linkedScene3DId}
          linkedGraphGroupId={node.linkedGraphId ?? node.linkedGraphGroupId}
          connectionSummary={connectionSummary}
          onExecuteCodeNode={onExecuteCodeNode}
          compact={node.w < 460}
          isLightTheme={_isLightTheme}
          onChangeTabs={(tabs, nextActiveId) =>
            onUpdate(
              {
                tabs,
                activeTabId: nextActiveId ?? node.activeTabId
              },
              { history: false }
            )
          }
          onSendOutputToNote={onSendOutputToNote}
          onSpawnGraphFromCode={onSpawnGraphFromCode}
          onSpawnScene3DFromCode={onSpawnScene3DFromCode}
          onAskAI={onAskAI}
          onToast={onToast}
        />
      </div>

      {/* Flowchart Connection Ports (4 edge circular dots for linking Code <-> Code / Graph / 3D) */}
      {!disabledPointerEvents &&
        onStartConnect &&
        (isSelected || isHovered || isResizing) &&
        (['top', 'right', 'bottom', 'left'] as const).map((port) => (
          <button
            key={`code-port-${port}`}
            type="button"
            className={`card-flow-port-handle pos-${port}`}
            title="Drag to connect to another Code Card, 2D Graph, or 3D Scene (click to spawn connected Code Card)"
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.preventDefault()
              e.stopPropagation()
              onSelect()
              onStartConnect(node.id, port, e.clientX, e.clientY)
            }}
          />
        ))}

      {/* Bottom-right corner resize grip */}
      {!disabledPointerEvents && onStartResize && (
        <div
          className="resize-corner-grip"
          onPointerDown={(e) => {
            e.stopPropagation()
            onStartResize(e, 'se')
          }}
          title="Drag corner to resize container"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M8.5 1.5L1.5 8.5M8.5 5L5 8.5M8.5 8.5L8.5 8.51"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* Resize edges & 8 corner/midpoint handles */}
      {!disabledPointerEvents && onStartResize && (
        <div className="card-resize-handles">
          {(['n', 's', 'e', 'w'] as const).map((dir) => (
            <div
              key={`code-edge-${dir}`}
              className={`resize-edge ${dir}`}
              title={`Drag ${dir === 'n' ? 'top' : dir === 's' ? 'bottom' : dir === 'e' ? 'right' : 'left'} edge to resize`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onStartResize(e, dir)
              }}
            />
          ))}
          {(isSelected || isHovered || isResizing) &&
            (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((dir) => (
              <div
                key={`code-handle-${dir}`}
                className={`resize-handle ${dir}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onStartResize(e, dir)
                }}
              />
            ))}
        </div>
      )}
    </div>
  )
}
