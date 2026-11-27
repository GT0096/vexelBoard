import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { Check, Copy } from 'lucide-react'
import { normalizeScene3DInput } from '@shared/scene3dSchema'
import { Inline3DViewer } from './Canvas3DScene'

let mermaidInit: Promise<typeof import('mermaid').default> | null = null
let mermaidCounter = 0

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidInit) {
    mermaidInit = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict' })
      return m.default
    })
  }
  return mermaidInit
}

function autoRepairMermaid(src: string): string {
  let s = src.trim()
  // Ensure unquoted brackets or parentheses inside labels are quoted
  s = s.replace(/([A-Za-z0-9_]+)\[([^"\]\n]+)\]/g, (_m, id, text) => `${id}["${text.trim()}"]`)
  s = s.replace(/([A-Za-z0-9_]+)\(([^")\n]+)\)/g, (_m, id, text) => `${id}("${text.trim()}")`)
  s = s.replace(/([A-Za-z0-9_]+)\{([^"}\n]+)\}/g, (_m, id, text) => `${id}{"${text.trim()}"}`)
  s = s.replace(/-->\|([^"|\n]+)\|/g, (_m, lbl) => `-->|"${lbl.trim()}"|`)
  return s
}

function extractNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractNodeText).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractNodeText(node.props.children)
  }
  return ''
}

const CopyCornerButton: React.FC<{ text: string; label?: string; title?: string }> = ({
  text,
  label = 'Copy',
  title = 'Copy code'
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore clipboard error */
    }
  }

  return (
    <button
      type="button"
      className={`md-code-copy-btn ${copied ? 'copied' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={handleCopy}
      title={copied ? 'Copied!' : title}
      aria-label={copied ? 'Copied' : title}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

const CodeBlockWithCopy: React.FC<{
  children: React.ReactNode
  preProps: React.HTMLAttributes<HTMLPreElement>
}> = ({ children, preProps }) => {
  const childArray = React.Children.toArray(children)
  const firstChild = childArray[0]
  const codeClassName = React.isValidElement<{ className?: string }>(firstChild)
    ? firstChild.props.className || ''
    : ''
  const langMatch = /language-([\w+-]+)/i.exec(codeClassName)
  const lang = langMatch ? langMatch[1].toLowerCase() : ''

  if (lang === 'mermaid' || lang === '3d' || lang === 'scene3d' || lang === 'plot3d') {
    return <>{children}</>
  }

  const rawCode = extractNodeText(children).replace(/\n$/, '')

  return (
    <div className="md-code-block-wrap">
      <div className="md-code-block-topbar">
        {lang ? <span className="md-code-lang-pill">{lang}</span> : <span />}
        <CopyCornerButton text={rawCode} label="Copy" title="Copy code block" />
      </div>
      <pre {...preProps}>{children}</pre>
    </div>
  )
}

const Scene3DMarkdownBlock: React.FC<{ code: string }> = ({ code }) => {
  const spec = useMemo(() => normalizeScene3DInput(code), [code])
  return <Inline3DViewer spec={spec} height={220} compact />
}

const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const primaryCode = code.trim()
    const repairedCode = autoRepairMermaid(primaryCode)

    loadMermaid()
      .then((mermaid) => {
        // Try rendering first with repaired code
        return mermaid.render(`mmd-${++mermaidCounter}`, repairedCode).catch(() => {
          // Fallback: try raw code
          return mermaid.render(`mmd-${++mermaidCounter}`, primaryCode)
        })
      })
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e))
      })
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <div className="md-mermaid-error-wrap">
        <div className="md-mermaid-error-bar">
          <span>Mermaid Syntax Notice</span>
          <CopyCornerButton text={code} label="Copy Code" title="Copy Mermaid code" />
        </div>
        <pre className="md-mermaid-error">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className="md-mermaid-wrap">
      <div className="md-mermaid-topbar">
        <span className="md-code-lang-pill">mermaid</span>
        <CopyCornerButton text={code} label="Copy" title="Copy Mermaid diagram code" />
      </div>
      <div ref={ref} className="md-mermaid" />
    </div>
  )
}

export const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{
      a({ href, children, ...rest }) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (href && /^(https?:|mailto:)/i.test(href)) {
                e.preventDefault()
                e.stopPropagation()
                if (window.glassAPI?.openExternal) {
                  void window.glassAPI.openExternal(href)
                } else {
                  window.open(href, '_blank', 'noopener,noreferrer')
                }
              }
            }}
            {...rest}
          >
            {children}
          </a>
        )
      },
      pre({ children, ...rest }) {
        return <CodeBlockWithCopy preProps={rest}>{children}</CodeBlockWithCopy>
      },
      code({ className, children, ...rest }) {
        const lang = /language-([\w+-]+)/.exec(className || '')?.[1]?.toLowerCase()
        if (lang === 'mermaid') {
          return <MermaidBlock code={String(children).replace(/\n$/, '')} />
        }
        if (lang === '3d' || lang === 'scene3d' || lang === 'plot3d') {
          return <Scene3DMarkdownBlock code={String(children).replace(/\n$/, '')} />
        }
        return (
          <code className={className} {...rest}>
            {children}
          </code>
        )
      }
    }}
  >
    {text}
  </ReactMarkdown>
)
