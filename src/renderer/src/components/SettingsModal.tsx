import { useCallback, useEffect, useState } from 'react'
import { Check, Globe, KeyRound, Loader2, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import {
  BYOK_PROVIDERS,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_WEB_SEARCH_SETTINGS,
  GEMMA_CLOUD_MODELS,
  PROVIDER_LABELS,
  resolveOpenAIModelProfile,
  type ByokProvider,
  type OllamaStatus,
  type ProviderId,
  type WebSearchResponse
} from '@shared/ipc'
import type { AISettings } from '../types/board'
import { notifyAiConfigChanged } from '../board/useAiReadiness'

interface SettingsModalProps {
  ai: AISettings
  onChangeAI: (ai: AISettings) => void
  onClose: () => void
  onToast: (kind: 'info' | 'success' | 'error', message: string) => void
}

const PROVIDERS: ProviderId[] = ['ollama', ...BYOK_PROVIDERS]

function hostPort(host: string): string {
  try {
    return new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`).port || '80'
  } catch {
    return '11434'
  }
}

export function SettingsModal(p: SettingsModalProps): React.JSX.Element {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [hostDraft, setHostDraft] = useState(p.ai.ollamaHost)
  const [keyDrafts, setKeyDrafts] = useState<Record<ByokProvider, string>>({
    openai: '',
    gemini: '',
    grok: '',
    claude: ''
  })
  const [stored, setStored] = useState<Record<ByokProvider, boolean>>({
    openai: false,
    gemini: false,
    grok: false,
    claude: false
  })
  const [encryption, setEncryption] = useState<boolean | null>(null)
  const rawWs = { ...DEFAULT_WEB_SEARCH_SETTINGS, ...(p.ai.webSearch ?? {}) }
  const ws = {
    ...rawWs,
    providerMode:
      rawWs.providerMode ??
      (rawWs.searxngUrl && rawWs.searxngUrl !== 'http://localhost:8888' ? 'searxng' : 'builtin')
  }
  const [searxUrlDraft, setSearxUrlDraft] = useState(
    ws.searxngUrl && ws.searxngUrl !== 'http://localhost:8888' ? ws.searxngUrl : ''
  )
  const [wsTesting, setWsTesting] = useState(false)
  const [wsTestResult, setWsTestResult] = useState<WebSearchResponse | null>(null)

  const api = window.glassAPI

  const recheck = useCallback(
    async (host: string, enableIfOnline = false) => {
      if (!api) return
      setChecking(true)
      try {
        const res = await api.checkOllama(host)
        setStatus(res)
        if (enableIfOnline && res.online) {
          p.onChangeAI({ ...p.ai, ollamaHost: host, configured: true })
          notifyAiConfigChanged()
          p.onToast('success', 'Ollama connected & AI features enabled')
        }
      } finally {
        setChecking(false)
      }
    },
    [api, p]
  )

  useEffect(() => {
    void recheck(p.ai.ollamaHost)
    if (!api) return
    void api.isEncryptionAvailable().then(setEncryption)
    void Promise.all(BYOK_PROVIDERS.map((id) => api.hasKey(id))).then((r) =>
      setStored({ openai: r[0], gemini: r[1], grok: r[2], claude: r[3] })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') p.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const saveKey = async (id: ByokProvider): Promise<void> => {
    if (!api) return
    try {
      const trimmed = keyDrafts[id].trim()
      await api.saveKey(id, trimmed)
      const hasVal = Boolean(trimmed)
      setStored((s) => ({ ...s, [id]: hasVal }))
      setKeyDrafts((d) => ({ ...d, [id]: '' }))
      if (hasVal) {
        const nextProvider = !p.ai.configured ? id : p.ai.provider
        if (nextProvider === 'openai') {
          const targetModel = p.ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai
          const profile = resolveOpenAIModelProfile(targetModel)
          p.onChangeAI({
            ...p.ai,
            provider: nextProvider,
            temperature: profile.idealTemperature,
            openaiModelProfile: profile,
            configured: true
          })
        } else {
          p.onChangeAI({
            ...p.ai,
            provider: nextProvider,
            configured: true
          })
        }
      }
      notifyAiConfigChanged()
      p.onToast('success', `${PROVIDER_LABELS[id]} key encrypted & saved`)
    } catch (err) {
      p.onToast('error', err instanceof Error ? err.message : String(err))
    }
  }

  const deleteKey = async (id: ByokProvider): Promise<void> => {
    if (!api) return
    await api.deleteKey(id)
    setStored((s) => ({ ...s, [id]: false }))
    notifyAiConfigChanged()
    p.onToast('info', `${PROVIDER_LABELS[id]} key removed`)
  }

  const runWebSearchTest = async (): Promise<void> => {
    if (!api?.testWebSearch) {
      p.onToast('error', 'Web search bridge unavailable')
      return
    }
    const nextWs = { ...ws, searxngUrl: searxUrlDraft.trim() }
    p.onChangeAI({ ...p.ai, webSearch: nextWs })
    setWsTesting(true)
    try {
      const res = await api.testWebSearch(nextWs)
      setWsTestResult(res)
      if (res.ok) {
        p.onToast('success', `Connected via ${res.provider} (${res.results.length} results, ${res.durationMs} ms)`)
      } else {
        p.onToast('error', res.error || 'Web search test failed')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setWsTestResult({
        ok: false,
        provider: 'none',
        query: 'open source search engine',
        results: [],
        attempts: [],
        durationMs: 0,
        error: msg
      })
      p.onToast('error', msg)
    } finally {
      setWsTesting(false)
    }
  }

  const models = status?.models ?? GEMMA_CLOUD_MODELS
  const modelOptions = models.includes(p.ai.ollamaModel) ? models : [p.ai.ollamaModel, ...models]

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <section className="modal glass" role="dialog" aria-labelledby="settings-title" id="settings-modal">
        <header className="modal-header">
          <h2 id="settings-title">AI Settings</h2>
          <button className="icon-btn" id="settings-close-btn" onClick={p.onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>

        <div className="modal-body">
          {/* Active provider */}
          <div className="field">
            <label>Active provider</label>
            <div className="provider-grid">
              {PROVIDERS.map((id) => {
                const ready = id === 'ollama' ? status?.online : stored[id as ByokProvider]
                return (
                  <button
                    key={id}
                    id={`provider-${id}-btn`}
                    className={`provider-chip ${p.ai.provider === id ? 'active' : ''}`}
                    onClick={() => {
                      if (id === 'openai') {
                        const targetModel = p.ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai
                        const profile = resolveOpenAIModelProfile(targetModel)
                        p.onChangeAI({
                          ...p.ai,
                          provider: id,
                          temperature: profile.idealTemperature,
                          openaiModelProfile: profile
                        })
                        if (api?.getOpenAIModelConfig) {
                          void api.getOpenAIModelConfig(targetModel).then((remote) => {
                            p.onChangeAI({
                              ...p.ai,
                              provider: id,
                              byokModels: { ...p.ai.byokModels, openai: remote.model },
                              temperature: remote.idealTemperature,
                              openaiModelProfile: remote
                            })
                          })
                        }
                      } else if (id === 'ollama') {
                        p.onChangeAI({
                          ...p.ai,
                          provider: id,
                          configured: status?.online ? true : p.ai.configured
                        })
                        notifyAiConfigChanged()
                      } else {
                        p.onChangeAI({ ...p.ai, provider: id })
                        notifyAiConfigChanged()
                      }
                    }}
                  >
                    <span className={`dot ${ready ? 'ok' : 'off'}`} />
                    {PROVIDER_LABELS[id]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Ollama */}
          <div className="card">
            <div className="card-title">
              <h3>Ollama</h3>
              <span className={`status-pill ${status?.online ? 'ok' : 'off'}`} id="ollama-status">
                {checking ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <span className={`dot ${status?.online ? 'ok' : 'off'}`} />
                )}
                {status?.online ? `Connected ${hostPort(p.ai.ollamaHost)}` : 'Offline'}
              </span>
            </div>
            <div className="row">
              <input
                id="ollama-host-input"
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                onBlur={() => p.onChangeAI({ ...p.ai, ollamaHost: hostDraft })}
                placeholder="http://localhost:11434"
                spellCheck={false}
              />
              <button
                id="ollama-recheck-btn"
                className="btn"
                onClick={() => {
                  p.onChangeAI({ ...p.ai, ollamaHost: hostDraft })
                  void recheck(hostDraft, true)
                }}
              >
                <RefreshCw size={14} className={checking ? 'spin' : ''} /> Re-check Ollama
              </button>
              {status?.online && !p.ai.configured && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    p.onChangeAI({ ...p.ai, provider: 'ollama', ollamaHost: hostDraft, configured: true })
                    notifyAiConfigChanged()
                    p.onToast('success', 'Ollama AI enabled')
                  }}
                >
                  Enable Ollama
                </button>
              )}
            </div>
            <div className="row">
              <select
                id="ollama-model-select"
                value={p.ai.ollamaModel}
                onChange={(e) => {
                  p.onChangeAI({
                    ...p.ai,
                    ollamaModel: e.target.value,
                    configured: status?.online ? true : p.ai.configured
                  })
                  notifyAiConfigChanged()
                }}
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {GEMMA_CLOUD_MODELS.includes(m) ? ' (cloud/default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            {status && !status.online && status.error && <p className="hint error">{status.error}</p>}
          </div>

          {/* BYOK */}
          <div className="card">
            <div className="card-title">
              <h3>Bring your own key</h3>
              <span className={`status-pill ${encryption ? 'ok' : 'off'}`}>
                <ShieldCheck size={12} />
                {encryption === null ? '…' : encryption ? 'OS encryption on' : 'Encryption unavailable'}
              </span>
            </div>
            <p className="hint">Keys are encrypted with Electron safeStorage and never leave the main process.</p>
            {BYOK_PROVIDERS.map((id) => (
              <div className="byok-row" key={id}>
                <div className="byok-label">
                  <KeyRound size={14} />
                  <span>{PROVIDER_LABELS[id]}</span>
                  {stored[id] && (
                    <span className="stored">
                      <Check size={12} /> stored
                    </span>
                  )}
                </div>
                <input
                  id={`key-${id}-input`}
                  type="password"
                  autoComplete="off"
                  placeholder={stored[id] ? '•••••••• (replace key)' : 'Paste API key'}
                  value={keyDrafts[id]}
                  onChange={(e) => setKeyDrafts((d) => ({ ...d, [id]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && void saveKey(id)}
                />
                <input
                  id={`model-${id}-input`}
                  className="model-input"
                  value={p.ai.byokModels[id]}
                  placeholder={DEFAULT_PROVIDER_MODELS[id]}
                  onChange={(e) => {
                    const nextVal = e.target.value
                    if (id === 'openai') {
                      const profile = resolveOpenAIModelProfile(nextVal || DEFAULT_PROVIDER_MODELS.openai)
                      p.onChangeAI({
                        ...p.ai,
                        byokModels: { ...p.ai.byokModels, openai: nextVal },
                        temperature: profile.idealTemperature,
                        openaiModelProfile: profile
                      })
                    } else {
                      p.onChangeAI({ ...p.ai, byokModels: { ...p.ai.byokModels, [id]: nextVal } })
                    }
                  }}
                  onBlur={(e) => {
                    if (id === 'openai' && api?.getOpenAIModelConfig) {
                      const target = e.target.value.trim() || DEFAULT_PROVIDER_MODELS.openai
                      void api.getOpenAIModelConfig(target).then((remote) => {
                        p.onChangeAI({
                          ...p.ai,
                          byokModels: { ...p.ai.byokModels, openai: remote.model },
                          temperature: remote.idealTemperature,
                          openaiModelProfile: remote
                        })
                      })
                    }
                  }}
                  spellCheck={false}
                  title="Model id"
                />
                <button
                  id={`key-${id}-save-btn`}
                  className="btn primary"
                  disabled={!keyDrafts[id].trim()}
                  onClick={() => void saveKey(id)}
                >
                  Save
                </button>
                <button
                  id={`key-${id}-delete-btn`}
                  className="icon-btn danger"
                  disabled={!stored[id]}
                  onClick={() => void deleteKey(id)}
                  title="Remove key"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Web Search (Zero-Config Built-in Open MetaSearch + Optional Custom Endpoint) */}
          <div className="card">
            <div className="card-title">
              <h3>Web Search</h3>
              <span
                className={`status-pill ${wsTestResult ? (wsTestResult.ok ? 'ok' : 'off') : ws.enabled ? 'ok' : 'off'}`}
                id="web-search-status"
              >
                {wsTesting ? (
                  <Loader2 size={12} className="spin" />
                ) : (
                  <span
                    className={`dot ${wsTestResult ? (wsTestResult.ok ? 'ok' : 'off') : ws.enabled ? 'ok' : 'off'}`}
                  />
                )}
                {wsTestResult
                  ? wsTestResult.ok
                    ? `${wsTestResult.provider} (${wsTestResult.results.length} results)`
                    : 'Unavailable'
                  : ws.enabled
                    ? 'Built-in Ready'
                    : 'Disabled'}
              </span>
            </div>

            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="ws-check-row">
                <input
                  id="web-search-enabled-toggle"
                  type="checkbox"
                  checked={ws.enabled}
                  onChange={(e) =>
                    p.onChangeAI({
                      ...p.ai,
                      webSearch: { ...ws, enabled: e.target.checked }
                    })
                  }
                />
                <span>Let the agent search the internet</span>
              </label>

              <button
                id="web-search-test-btn"
                type="button"
                className="btn primary"
                disabled={wsTesting}
                onClick={() => void runWebSearchTest()}
              >
                {wsTesting ? <Loader2 size={14} className="spin" /> : <Globe size={14} />}
                Test search
              </button>
            </div>

            {wsTestResult && (
              <p className={`hint ${wsTestResult.ok ? '' : 'error'}`}>
                {wsTestResult.ok
                  ? `Connected via ${wsTestResult.provider} (${wsTestResult.results.length} results, ${wsTestResult.durationMs} ms)`
                  : wsTestResult.error || 'Web search test failed.'}
              </p>
            )}

            <p className="hint">
              Works immediately with <strong>zero setup or Docker</strong> — aggregates live results
              directly from DuckDuckGo, Wikipedia, Stack Overflow, arXiv, OpenAlex, and Hacker News
              inside Vexelboard.
            </p>

            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: 0.8 }}>
                Advanced: Use a custom self-hosted SearXNG URL (optional)
              </summary>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className="ws-check-row">
                  <input
                    id="web-search-custom-mode"
                    type="checkbox"
                    checked={ws.providerMode === 'searxng'}
                    onChange={(e) =>
                      p.onChangeAI({
                        ...p.ai,
                        webSearch: {
                          ...ws,
                          providerMode: e.target.checked ? 'searxng' : 'builtin',
                          searxngUrl: searxUrlDraft.trim()
                        }
                      })
                    }
                  />
                  <span>Prefer custom SearXNG server before built-in metasearch</span>
                </label>
                {ws.providerMode === 'searxng' && (
                  <input
                    id="searxng-url-input"
                    value={searxUrlDraft}
                    onChange={(e) => setSearxUrlDraft(e.target.value)}
                    onBlur={() =>
                      p.onChangeAI({
                        ...p.ai,
                        webSearch: { ...ws, searxngUrl: searxUrlDraft.trim() }
                      })
                    }
                    placeholder="https://your-searxng-instance.example"
                    spellCheck={false}
                  />
                )}
              </div>
            </details>
          </div>
        </div>
      </section>
    </div>
  )
}
