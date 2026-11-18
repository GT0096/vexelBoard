import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

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
  s = s.replace(/([A-Za-z0-9_]+)\(([^"\)\n]+)\)/g, (_m, id, text) => `${id}("${text.trim()}")`)
  s = s.replace(/([A-Za-z0-9_]+)\{([^"\}\n]+)\}/g, (_m, id, text) => `${id}{"${text.trim()}"}`)
  s = s.replace(/-->\|([^"\|\n]+)\|/g, (_m, lbl) => `-->|"${lbl.trim()}"|`)
  return s
}

const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const primaryCode = code.trim()
    const repairedCode = autoRepairMermaid(primaryCode)

    loadMermaid()
      .then((mermaid) => {
        // Try rendering first with repaired code
        return mermaid
          .render(`mmd-${++mermaidCounter}`, repairedCode)
          .catch(() => {
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

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  if (error) {
    return (
      <div className="md-mermaid-error-wrap">
        <div className="md-mermaid-error-bar">
          <span>Mermaid Syntax Notice</span>
          <button type="button" onClick={handleCopy} className="md-mermaid-copy-btn">
            {copied ? 'Copied' : 'Copy Code'}
          </button>
        </div>
        <pre className="md-mermaid-error">
          <code>{code}</code>
        </pre>
      </div>
    )
  }
  return <div ref={ref} className="md-mermaid" />
}

export const Markdown: React.FC<{ text: string }> = ({ text }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{
      code({ className, children, ...rest }) {
        const lang = /language-(\w+)/.exec(className || '')?.[1]
        if (lang === 'mermaid') {
          return <MermaidBlock code={String(children).replace(/\n$/, '')} />
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
