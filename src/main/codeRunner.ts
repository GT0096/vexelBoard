import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CodeExecutionRequest, CodeExecutionResult, CodeRuntimeInfo } from '../shared/ipc'

const MAX_OUTPUT_CHARS = 256 * 1024
const IS_WIN = process.platform === 'win32'

interface SpawnAttemptResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  enoent: boolean
  errorMessage?: string
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (IS_WIN) {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* process already exited */
    }
  }
}

function appendCapped(current: string, chunk: Buffer | string): { next: string; truncated: boolean } {
  const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  if (current.length >= MAX_OUTPUT_CHARS) {
    return { next: current, truncated: true }
  }
  const remaining = MAX_OUTPUT_CHARS - current.length
  if (str.length <= remaining) {
    return { next: current + str, truncated: false }
  }
  return { next: current + str.slice(0, remaining), truncated: true }
}

function runCommand(
  cmd: string,
  args: string[],
  opts: {
    cwd: string
    stdin?: string
    timeoutMs: number
    env?: NodeJS.ProcessEnv
  }
): Promise<SpawnAttemptResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let settled = false

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        windowsHide: true,
        detached: !IS_WIN,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        enoent: e?.code === 'ENOENT',
        errorMessage: e?.message || String(err)
      })
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      killProcessTree(child.pid)
    }, opts.timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      const res = appendCapped(stdout, chunk)
      stdout = res.next
      if (res.truncated) stdoutTruncated = true
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const res = appendCapped(stderr, chunk)
      stderr = res.next
      if (res.truncated) stderrTruncated = true
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        enoent: err?.code === 'ENOENT',
        errorMessage: err?.message || String(err)
      })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (stdoutTruncated) stdout += '\n...[stdout truncated at 256 KB]'
      if (stderrTruncated) stderr += '\n...[stderr truncated at 256 KB]'
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        enoent: false
      })
    })

    try {
      if (opts.stdin !== undefined && opts.stdin.length > 0) {
        child.stdin?.write(opts.stdin)
      }
      child.stdin?.end()
    } catch {
      /* ignore stdin write errors when child exits immediately */
    }
  })
}

async function runWithFallbacks(
  candidates: Array<{ cmd: string; args: string[]; env?: NodeJS.ProcessEnv; label?: string }>,
  opts: { cwd: string; stdin?: string; timeoutMs: number }
): Promise<{ result: SpawnAttemptResult; usedCommand: string }> {
  let lastResult: SpawnAttemptResult = {
    exitCode: null,
    stdout: '',
    stderr: '',
    timedOut: false,
    enoent: true,
    errorMessage: 'No runtime candidates provided'
  }
  let usedCommand = candidates[0]?.label || candidates[0]?.cmd || ''

  for (const candidate of candidates) {
    usedCommand = candidate.label || `${candidate.cmd} ${candidate.args.join(' ')}`.trim()
    const res = await runCommand(candidate.cmd, candidate.args, {
      cwd: opts.cwd,
      stdin: opts.stdin,
      timeoutMs: opts.timeoutMs,
      env: candidate.env
    })
    lastResult = res
    if (!res.enoent) {
      return { result: res, usedCommand }
    }
  }

  return { result: lastResult, usedCommand }
}

function normalizeLanguage(raw: string): string {
  const l = (raw || '').trim().toLowerCase()
  switch (l) {
    case 'js':
    case 'node':
    case 'nodejs':
    case 'jsx':
      return 'javascript'
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'py':
    case 'python3':
      return 'python'
    case 'c++':
    case 'cxx':
    case 'cc':
      return 'cpp'
    case 'golang':
      return 'go'
    case 'rs':
      return 'rust'
    case 'rb':
      return 'ruby'
    case 'ps1':
    case 'pwsh':
      return 'powershell'
    case 'sh':
    case 'shell':
    case 'zsh':
      return 'bash'
    case 'c#':
    case 'cs':
      return 'csharp'
    case 'pl':
      return 'perl'
    default:
      return l
  }
}

function missingRuntimeHelp(language: string, attempted: string): string {
  const hints: Record<string, string> = {
    python: 'Install Python 3 from python.org and ensure "python" (or "py") is on PATH.',
    javascript: 'Install Node.js from nodejs.org.',
    typescript: 'Install Node.js 22+ (with --experimental-strip-types) or tsx/ts-node.',
    cpp: 'Install g++ (MinGW-w64 on Windows, build-essential on Linux, Xcode CLT on macOS) or clang++.',
    c: 'Install gcc (MinGW-w64 on Windows, build-essential on Linux, Xcode CLT on macOS) or clang.',
    java: 'Install a JDK (Adoptium/Oracle) and ensure "javac" and "java" are on PATH.',
    go: 'Install Go from go.dev and ensure "go" is on PATH.',
    rust: 'Install Rust via rustup.rs and ensure "rustc" is on PATH.',
    ruby: 'Install Ruby and ensure "ruby" is on PATH.',
    php: 'Install PHP and ensure "php" is on PATH.',
    powershell: 'Ensure PowerShell ("powershell" or "pwsh") is installed and on PATH.',
    bash: 'Install Git Bash / WSL (Windows) or ensure "bash"/"sh" is on PATH.',
    lua: 'Install Lua and ensure "lua" is on PATH.',
    perl: 'Install Perl and ensure "perl" is on PATH.',
    r: 'Install R and ensure "Rscript" is on PATH.',
    csharp: 'Install .NET SDK / dotnet-script or C# compiler (csc) and ensure it is on PATH.'
  }
  const hint = hints[language] || `Ensure the "${attempted}" runtime/compiler is installed and on PATH.`
  return `Runtime not found for "${language}" (attempted: ${attempted}).\n${hint}`
}

export async function runCodeSnippet(req: CodeExecutionRequest): Promise<CodeExecutionResult> {
  const language = normalizeLanguage(req.language)
  const code = req.code ?? ''
  const timeoutMs = Math.min(30000, Math.max(1000, req.timeoutMs ?? 10000))
  const startTime = Date.now()
  const tempDir = mkdtempSync(join(tmpdir(), 'vgb-code-'))

  try {
    const exeName = IS_WIN ? 'main.exe' : 'main'
    const exePath = join(tempDir, exeName)

    if (language === 'javascript') {
      const filePath = join(tempDir, 'main.js')
      writeFileSync(filePath, code, 'utf8')
      const { result, usedCommand } = await runWithFallbacks(
        [
          { cmd: 'node', args: ['main.js'], label: 'node main.js' },
          {
            cmd: process.execPath,
            args: ['main.js'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            label: 'electron-node main.js'
          }
        ],
        { cwd: tempDir, stdin: req.stdin, timeoutMs }
      )
      return formatResult(language, result, usedCommand, startTime, timeoutMs)
    }

    if (language === 'typescript') {
      const filePath = join(tempDir, 'main.ts')
      writeFileSync(filePath, code, 'utf8')
      const { result, usedCommand } = await runWithFallbacks(
        [
          {
            cmd: 'node',
            args: ['--experimental-strip-types', '--no-warnings', 'main.ts'],
            label: 'node --experimental-strip-types main.ts'
          },
          {
            cmd: process.execPath,
            args: ['--experimental-strip-types', '--no-warnings', 'main.ts'],
            env: { ELECTRON_RUN_AS_NODE: '1' },
            label: 'electron-node --experimental-strip-types main.ts'
          },
          {
            cmd: IS_WIN ? 'tsx.cmd' : 'tsx',
            args: ['main.ts'],
            label: 'tsx main.ts'
          },
          {
            cmd: IS_WIN ? 'ts-node.cmd' : 'ts-node',
            args: ['main.ts'],
            label: 'ts-node main.ts'
          }
        ],
        { cwd: tempDir, stdin: req.stdin, timeoutMs }
      )
      return formatResult(language, result, usedCommand, startTime, timeoutMs)
    }

    if (language === 'python') {
      const filePath = join(tempDir, 'main.py')
      writeFileSync(filePath, code, 'utf8')
      const pyEnv: NodeJS.ProcessEnv = {
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
      const { result, usedCommand } = await runWithFallbacks(
        [
          { cmd: 'python', args: ['-u', 'main.py'], env: pyEnv, label: 'python -u main.py' },
          { cmd: 'python3', args: ['-u', 'main.py'], env: pyEnv, label: 'python3 -u main.py' },
          { cmd: 'py', args: ['-u', 'main.py'], env: pyEnv, label: 'py -u main.py' }
        ],
        { cwd: tempDir, stdin: req.stdin, timeoutMs }
      )
      return formatResult(language, result, usedCommand, startTime, timeoutMs)
    }

    if (language === 'cpp') {
      const filePath = join(tempDir, 'main.cpp')
      writeFileSync(filePath, code, 'utf8')
      const compile = await runWithFallbacks(
        [
          { cmd: 'g++', args: ['-O2', 'main.cpp', '-o', exeName], label: `g++ -O2 main.cpp -o ${exeName}` },
          {
            cmd: 'clang++',
            args: ['-O2', 'main.cpp', '-o', exeName],
            label: `clang++ -O2 main.cpp -o ${exeName}`
          }
        ],
        { cwd: tempDir, timeoutMs }
      )
      if (compile.result.enoent || compile.result.timedOut || compile.result.exitCode !== 0) {
        return formatResult(language, compile.result, compile.usedCommand, startTime, timeoutMs)
      }
      const elapsed = Date.now() - startTime
      const remainingTimeout = Math.max(1000, timeoutMs - elapsed)
      const execRes = await runCommand(exePath, [], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs: remainingTimeout
      })
      return formatResult(language, execRes, `${compile.usedCommand} && ${exeName}`, startTime, timeoutMs)
    }

    if (language === 'c') {
      const filePath = join(tempDir, 'main.c')
      writeFileSync(filePath, code, 'utf8')
      const compile = await runWithFallbacks(
        [
          { cmd: 'gcc', args: ['-O2', 'main.c', '-o', exeName], label: `gcc -O2 main.c -o ${exeName}` },
          { cmd: 'clang', args: ['-O2', 'main.c', '-o', exeName], label: `clang -O2 main.c -o ${exeName}` }
        ],
        { cwd: tempDir, timeoutMs }
      )
      if (compile.result.enoent || compile.result.timedOut || compile.result.exitCode !== 0) {
        return formatResult(language, compile.result, compile.usedCommand, startTime, timeoutMs)
      }
      const elapsed = Date.now() - startTime
      const remainingTimeout = Math.max(1000, timeoutMs - elapsed)
      const execRes = await runCommand(exePath, [], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs: remainingTimeout
      })
      return formatResult(language, execRes, `${compile.usedCommand} && ${exeName}`, startTime, timeoutMs)
    }

    if (language === 'java') {
      const classMatch = code.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/)
      const className = classMatch ? classMatch[1] : 'Main'
      const sourceFile = `${className}.java`
      writeFileSync(join(tempDir, sourceFile), code, 'utf8')
      const compile = await runCommand('javac', ['-encoding', 'UTF-8', sourceFile], {
        cwd: tempDir,
        timeoutMs
      })
      if (compile.enoent || compile.timedOut || compile.exitCode !== 0) {
        return formatResult(language, compile, `javac ${sourceFile}`, startTime, timeoutMs)
      }
      const elapsed = Date.now() - startTime
      const remainingTimeout = Math.max(1000, timeoutMs - elapsed)
      const execRes = await runCommand('java', ['-Dfile.encoding=UTF-8', '-cp', '.', className], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs: remainingTimeout
      })
      return formatResult(language, execRes, `javac ${sourceFile} && java ${className}`, startTime, timeoutMs)
    }

    if (language === 'go') {
      writeFileSync(join(tempDir, 'main.go'), code, 'utf8')
      const res = await runCommand('go', ['run', 'main.go'], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs
      })
      return formatResult(language, res, 'go run main.go', startTime, timeoutMs)
    }

    if (language === 'rust') {
      writeFileSync(join(tempDir, 'main.rs'), code, 'utf8')
      const compile = await runCommand('rustc', ['main.rs', '-o', exeName], {
        cwd: tempDir,
        timeoutMs
      })
      if (compile.enoent || compile.timedOut || compile.exitCode !== 0) {
        return formatResult(language, compile, `rustc main.rs -o ${exeName}`, startTime, timeoutMs)
      }
      const elapsed = Date.now() - startTime
      const remainingTimeout = Math.max(1000, timeoutMs - elapsed)
      const execRes = await runCommand(exePath, [], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs: remainingTimeout
      })
      return formatResult(language, execRes, `rustc main.rs && ${exeName}`, startTime, timeoutMs)
    }

    if (language === 'ruby') {
      writeFileSync(join(tempDir, 'main.rb'), code, 'utf8')
      const res = await runCommand('ruby', ['main.rb'], { cwd: tempDir, stdin: req.stdin, timeoutMs })
      return formatResult(language, res, 'ruby main.rb', startTime, timeoutMs)
    }

    if (language === 'php') {
      writeFileSync(join(tempDir, 'main.php'), code, 'utf8')
      const res = await runCommand('php', ['main.php'], { cwd: tempDir, stdin: req.stdin, timeoutMs })
      return formatResult(language, res, 'php main.php', startTime, timeoutMs)
    }

    if (language === 'powershell') {
      writeFileSync(join(tempDir, 'main.ps1'), code, 'utf8')
      const { result, usedCommand } = await runWithFallbacks(
        [
          {
            cmd: 'powershell',
            args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'main.ps1'],
            label: 'powershell -File main.ps1'
          },
          {
            cmd: 'pwsh',
            args: ['-NoProfile', '-NonInteractive', '-File', 'main.ps1'],
            label: 'pwsh -File main.ps1'
          }
        ],
        { cwd: tempDir, stdin: req.stdin, timeoutMs }
      )
      return formatResult(language, result, usedCommand, startTime, timeoutMs)
    }

    if (language === 'bash') {
      writeFileSync(join(tempDir, 'main.sh'), code, 'utf8')
      const { result, usedCommand } = await runWithFallbacks(
        [
          { cmd: 'bash', args: ['main.sh'], label: 'bash main.sh' },
          { cmd: 'sh', args: ['main.sh'], label: 'sh main.sh' }
        ],
        { cwd: tempDir, stdin: req.stdin, timeoutMs }
      )
      return formatResult(language, result, usedCommand, startTime, timeoutMs)
    }

    if (language === 'lua') {
      writeFileSync(join(tempDir, 'main.lua'), code, 'utf8')
      const res = await runCommand('lua', ['main.lua'], { cwd: tempDir, stdin: req.stdin, timeoutMs })
      return formatResult(language, res, 'lua main.lua', startTime, timeoutMs)
    }

    if (language === 'perl') {
      writeFileSync(join(tempDir, 'main.pl'), code, 'utf8')
      const res = await runCommand('perl', ['main.pl'], { cwd: tempDir, stdin: req.stdin, timeoutMs })
      return formatResult(language, res, 'perl main.pl', startTime, timeoutMs)
    }

    if (language === 'r') {
      writeFileSync(join(tempDir, 'main.R'), code, 'utf8')
      const res = await runCommand('Rscript', ['main.R'], { cwd: tempDir, stdin: req.stdin, timeoutMs })
      return formatResult(language, res, 'Rscript main.R', startTime, timeoutMs)
    }

    if (language === 'csharp') {
      writeFileSync(join(tempDir, 'main.csx'), code, 'utf8')
      writeFileSync(join(tempDir, 'main.cs'), code, 'utf8')
      const dotnetScriptRes = await runCommand(IS_WIN ? 'dotnet-script.cmd' : 'dotnet-script', ['main.csx'], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs
      })
      if (!dotnetScriptRes.enoent) {
        return formatResult(language, dotnetScriptRes, 'dotnet-script main.csx', startTime, timeoutMs)
      }
      const compile = await runCommand('csc', ['-nologo', `-out:${exeName}`, 'main.cs'], {
        cwd: tempDir,
        timeoutMs
      })
      if (compile.enoent || compile.timedOut || compile.exitCode !== 0) {
        return formatResult(language, compile, 'dotnet-script / csc', startTime, timeoutMs)
      }
      const elapsed = Date.now() - startTime
      const execRes = await runCommand(exePath, [], {
        cwd: tempDir,
        stdin: req.stdin,
        timeoutMs: Math.max(1000, timeoutMs - elapsed)
      })
      return formatResult(language, execRes, `csc main.cs && ${exeName}`, startTime, timeoutMs)
    }

    return {
      ok: false,
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: Date.now() - startTime,
      language,
      error: `Local execution is not configured for "${req.language}". Switch to a runnable language (Python, JS, TS, C/C++, Java, Go, Rust, Ruby, PHP, PowerShell, Bash, Lua, Perl, R, C#) or use HTML preview.`
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore temp cleanup errors on locked Windows handles */
    }
  }
}

function formatResult(
  language: string,
  res: SpawnAttemptResult,
  command: string,
  startTime: number,
  timeoutMs: number
): CodeExecutionResult {
  const durationMs = Date.now() - startTime
  if (res.enoent) {
    return {
      ok: false,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: null,
      durationMs,
      language,
      command,
      error: missingRuntimeHelp(language, command)
    }
  }
  if (res.timedOut) {
    return {
      ok: false,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
      durationMs,
      language,
      command,
      timedOut: true,
      error: `Execution timed out after ${(timeoutMs / 1000).toFixed(1)}s.`
    }
  }
  if (res.errorMessage && res.exitCode === null) {
    return {
      ok: false,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: null,
      durationMs,
      language,
      command,
      error: res.errorMessage
    }
  }
  const ok = res.exitCode === 0
  return {
    ok,
    stdout: res.stdout,
    stderr: res.stderr,
    exitCode: res.exitCode,
    durationMs,
    language,
    command,
    ...(ok ? {} : { error: res.stderr.trim() ? undefined : `Process exited with code ${res.exitCode}` })
  }
}

let cachedRuntimes: Record<string, CodeRuntimeInfo> | null = null

async function probeRuntime(
  id: string,
  candidates: Array<{ cmd: string; args: string[]; label: string; env?: NodeJS.ProcessEnv }>
): Promise<CodeRuntimeInfo> {
  const cwd = tmpdir()
  for (const c of candidates) {
    const res = await runCommand(c.cmd, c.args, { cwd, timeoutMs: 2500, env: c.env })
    if (!res.enoent && !res.timedOut && res.exitCode === 0) {
      const rawVer = (res.stdout || res.stderr).trim().split(/\r?\n/)[0] || 'available'
      return {
        id,
        available: true,
        command: c.label,
        version: rawVer.slice(0, 80)
      }
    }
  }
  return {
    id,
    available: false,
    command: candidates[0]?.label || id
  }
}

export async function checkCodeRuntimes(): Promise<Record<string, CodeRuntimeInfo>> {
  if (cachedRuntimes) return cachedRuntimes

  const checks = await Promise.all([
    probeRuntime('javascript', [
      { cmd: 'node', args: ['-v'], label: 'node' },
      {
        cmd: process.execPath,
        args: ['-v'],
        label: 'electron-node',
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    ]),
    probeRuntime('typescript', [
      { cmd: 'node', args: ['-v'], label: 'node' },
      {
        cmd: process.execPath,
        args: ['-v'],
        label: 'electron-node',
        env: { ELECTRON_RUN_AS_NODE: '1' }
      }
    ]),
    probeRuntime('python', [
      { cmd: 'python', args: ['--version'], label: 'python' },
      { cmd: 'python3', args: ['--version'], label: 'python3' },
      { cmd: 'py', args: ['--version'], label: 'py' }
    ]),
    probeRuntime('cpp', [
      { cmd: 'g++', args: ['--version'], label: 'g++' },
      { cmd: 'clang++', args: ['--version'], label: 'clang++' }
    ]),
    probeRuntime('c', [
      { cmd: 'gcc', args: ['--version'], label: 'gcc' },
      { cmd: 'clang', args: ['--version'], label: 'clang' }
    ]),
    probeRuntime('java', [{ cmd: 'javac', args: ['-version'], label: 'javac' }]),
    probeRuntime('go', [{ cmd: 'go', args: ['version'], label: 'go' }]),
    probeRuntime('rust', [{ cmd: 'rustc', args: ['--version'], label: 'rustc' }]),
    probeRuntime('ruby', [{ cmd: 'ruby', args: ['--version'], label: 'ruby' }]),
    probeRuntime('php', [{ cmd: 'php', args: ['--version'], label: 'php' }]),
    probeRuntime('powershell', [
      { cmd: 'powershell', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], label: 'powershell' },
      { cmd: 'pwsh', args: ['-Version'], label: 'pwsh' }
    ]),
    probeRuntime('bash', [
      { cmd: 'bash', args: ['--version'], label: 'bash' },
      { cmd: 'sh', args: ['--version'], label: 'sh' }
    ])
  ])

  const map: Record<string, CodeRuntimeInfo> = {}
  for (const info of checks) {
    map[info.id] = info
  }
  cachedRuntimes = map
  return map
}
