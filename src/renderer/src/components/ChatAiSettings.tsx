import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Thermometer,
  Trash2,
  X
} from 'lucide-react'
import {
  BYOK_PROVIDERS,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_WEB_SEARCH_SETTINGS,
  POPULAR_PROVIDER_MODELS,
  PROVIDER_LABELS,
  TEMPERATURE_PRESETS,
  resolveOpenAIModelProfile,
  type ByokProvider,
  type OllamaStatus,
  type OpenAIModelProfile,
  type ProviderId,
  type WebSearchResponse
} from '@shared/ipc'
import type { AISettings } from '../types/board'
import { notifyAiConfigChanged } from '../board/useAiReadiness'

export interface ChatAiSettingsProps {
  ai: AISettings
  onChangeAI: (ai: AISettings) => void
  onClose: () => void
  onToast?: (kind: 'info' | 'success' | 'error', message: string) => void
}

const PROVIDERS: ProviderId[] = ['ollama', ...BYOK_PROVIDERS]

const POPULAR_OLLAMA_MODELS = [
  'gemma4',
  'gemma4:cloud',
  'llama3.2-vision',
  'llava',
  'llama3.2',
  'llama3.1',
  'deepseek-r1',
  'mistral',
  'qwen2.5',
  'moondream',
  'minicpm-v'
]

export const ChatAiSettings: React.FC<ChatAiSettingsProps> = ({
  ai,
  onChangeAI,
  onClose,
  onToast
}) => {
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [fetchingModelConfig, setFetchingModelConfig] = useState(false)
  const [openAIProfile, setOpenAIProfile] = useState<OpenAIModelProfile | null>(
    () => ai.openaiModelProfile ?? resolveOpenAIModelProfile(ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai)
  )
  const [hostDraft, setHostDraft] = useState(ai.ollamaHost || 'http://localhost:11434')
  const [customModelDraft, setCustomModelDraft] = useState('')
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
  const rawWs = { ...DEFAULT_WEB_SEARCH_SETTINGS, ...(ai.webSearch ?? {}) }
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
  const aiRef = useRef(ai)
  useEffect(() => {
    aiRef.current = ai
  }, [ai])
  const openAIReqIdRef = useRef(0)

  const recheckOllama = useCallback(
    async (host: string, enableIfOnline = false) => {
      if (!api) return
      setChecking(true)
      try {
        const res = await api.checkOllama(host)
        setStatus(res)
        if (res.online) {
          const nextModel = aiRef.current.ollamaModel || res.models[0] || ''
          if (enableIfOnline) {
            onChangeAI({
              ...aiRef.current,
              ollamaHost: host,
              ollamaModel: nextModel,
              configured: true
            })
            notifyAiConfigChanged()
            onToast?.('success', 'Ollama connected & AI features enabled')
          } else if (res.models.length > 0 && !aiRef.current.ollamaModel) {
            onChangeAI({ ...aiRef.current, ollamaModel: res.models[0] })
          }
        }
      } catch {
        setStatus({ online: false, models: [], error: 'Could not connect to Ollama' })
      } finally {
        setChecking(false)
      }
    },
    [api, onChangeAI, onToast]
  )

  useEffect(() => {
    void recheckOllama(ai.ollamaHost)
    if (!api) return
    void api.isEncryptionAvailable().then(setEncryption)
    void Promise.all(BYOK_PROVIDERS.map((id) => api.hasKey(id))).then((r) =>
      setStored({ openai: r[0], gemini: r[1], grok: r[2], claude: r[3] })
    )
  }, [recheckOllama, ai.ollamaHost, api])

  const applyOpenAIModelIdealConfig = useCallback(
    async (modelName: string, baseAi: AISettings, silent = false): Promise<void> => {
      const reqId = ++openAIReqIdRef.current
      const trimmed = modelName.trim() || DEFAULT_PROVIDER_MODELS.openai
      const immediateProfile = resolveOpenAIModelProfile(trimmed)

      setOpenAIProfile(immediateProfile)
      const immediateNext: AISettings = {
        ...baseAi,
        byokModels: { ...baseAi.byokModels, openai: trimmed },
        temperature: immediateProfile.idealTemperature,
        openaiModelProfile: immediateProfile
      }
      onChangeAI(immediateNext)

      if (!api?.getOpenAIModelConfig) {
        if (!silent) {
          onToast?.(
            'info',
            `Auto-configured ${immediateProfile.model}: temp ${immediateProfile.idealTemperature.toFixed(1)}`
          )
        }
        return
      }

      setFetchingModelConfig(true)
      try {
        const remoteProfile = await api.getOpenAIModelConfig(trimmed)
        if (reqId !== openAIReqIdRef.current) return
        setOpenAIProfile(remoteProfile)
        const latest = aiRef.current
        onChangeAI({
          ...latest,
          provider: baseAi.provider,
          byokModels: {
            ...latest.byokModels,
            openai: remoteProfile.model
          },
          temperature: remoteProfile.idealTemperature,
          openaiModelProfile: remoteProfile
        })
        if (!silent) {
          onToast?.(
            'info',
            `Auto-configured ${remoteProfile.model}: temp ${remoteProfile.idealTemperature.toFixed(1)}${remoteProfile.verifiedFromApi ? ' (API verified)' : ''}`
          )
        }
      } catch {
        if (reqId === openAIReqIdRef.current && !silent) {
          onToast?.(
            'info',
            `Auto-configured ${immediateProfile.model}: temp ${immediateProfile.idealTemperature.toFixed(1)}`
          )
        }
      } finally {
        if (reqId === openAIReqIdRef.current) {
          setFetchingModelConfig(false)
        }
      }
    },
    [api, onChangeAI, onToast]
  )

  const handleSelectProvider = (provider: ProviderId): void => {
    openAIReqIdRef.current += 1
    setFetchingModelConfig(false)
    if (provider === 'openai') {
      const targetModel = ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai
      void applyOpenAIModelIdealConfig(targetModel, { ...ai, provider }, false)
      notifyAiConfigChanged()
      return
    }
    if (provider === 'ollama') {
      onChangeAI({
        ...ai,
        provider,
        configured: status?.online ? true : ai.configured
      })
      notifyAiConfigChanged()
      return
    }
    onChangeAI({ ...ai, provider })
    notifyAiConfigChanged()
  }

  const handleSelectModel = (model: string): void => {
    const trimmed = model.trim()
    if (!trimmed) return
    openAIReqIdRef.current += 1
    setFetchingModelConfig(false)
    if (ai.provider === 'ollama') {
      onChangeAI({
        ...ai,
        ollamaModel: trimmed,
        configured: status?.online ? true : ai.configured
      })
      notifyAiConfigChanged()
    } else if (ai.provider === 'openai') {
      const nextAi: AISettings = {
        ...ai,
        byokModels: {
          ...ai.byokModels,
          openai: trimmed
        }
      }
      void applyOpenAIModelIdealConfig(trimmed, nextAi, false)
    } else {
      onChangeAI({
        ...ai,
        byokModels: {
          ...ai.byokModels,
          [ai.provider]: trimmed
        }
      })
    }
  }

  const handleSaveCustomModel = (): void => {
    const trimmed = customModelDraft.trim()
    if (!trimmed) return
    handleSelectModel(trimmed)
    setCustomModelDraft('')
    if (ai.provider !== 'openai') {
      onToast?.('success', `Model set to ${trimmed}`)
    }
  }

  const handleSaveKey = async (id: ByokProvider): Promise<void> => {
    if (!api) return
    try {
      const trimmed = keyDrafts[id].trim()
      await api.saveKey(id, trimmed)
      const hasVal = Boolean(trimmed)
      setStored((s) => ({ ...s, [id]: hasVal }))
      setKeyDrafts((d) => ({ ...d, [id]: '' }))
      if (hasVal) {
        onChangeAI({
          ...aiRef.current,
          provider: !aiRef.current.configured ? id : aiRef.current.provider,
          configured: true
        })
      }
      notifyAiConfigChanged()
      onToast?.('success', `${PROVIDER_LABELS[id]} API key saved`)
      if (id === 'openai' && (aiRef.current.provider === 'openai' || !aiRef.current.configured)) {
        const currentOpenAI = aiRef.current.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai
        void applyOpenAIModelIdealConfig(
          currentOpenAI,
          { ...aiRef.current, provider: 'openai', configured: true },
          true
        )
      }
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteKey = async (id: ByokProvider): Promise<void> => {
    if (!api) return
    await api.deleteKey(id)
    setStored((s) => ({ ...s, [id]: false }))
    notifyAiConfigChanged()
    onToast?.('info', `${PROVIDER_LABELS[id]} key removed`)
  }

  // Active model depending on selected provider
  const currentActiveModel =
    ai.provider === 'ollama' ? ai.ollamaModel : ai.byokModels[ai.provider] || DEFAULT_PROVIDER_MODELS[ai.provider]

  const resolvedOpenAIProfile =
    openAIProfile && openAIProfile.model === (ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai)
      ? openAIProfile
      : ai.openaiModelProfile && ai.openaiModelProfile.model === (ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai)
        ? ai.openaiModelProfile
        : resolveOpenAIModelProfile(ai.byokModels.openai || DEFAULT_PROVIDER_MODELS.openai)

  const currentTemp = typeof ai.temperature === 'number' && Number.isFinite(ai.temperature) ? ai.temperature : 0.3
  const isTempLocked = ai.provider === 'openai' && !resolvedOpenAIProfile.supportsTemperature

  // Model list for Ollama
  const ollamaModels = Array.from(
    new Set([
      ...(status?.models && status.models.length > 0 ? status.models : []),
      ...POPULAR_OLLAMA_MODELS,
      ai.ollamaModel
    ].filter(Boolean))
  )

  // Model list for BYOK
  const byokModels = Array.from(
    new Set([
      ...(ai.provider !== 'ollama' ? POPULAR_PROVIDER_MODELS[ai.provider as ByokProvider] : []),
      currentActiveModel
    ].filter(Boolean))
  )

  return (
    <div className="chat-ai-settings-panel">
      {/* Header */}
      <div className="chat-ai-settings-header">
        <div className="chat-ai-settings-title">
          <Sparkles size={14} className="text-accent" />
          <span>AI Model & Provider</span>
        </div>
        <button className="icon-btn-ghost chat-ai-settings-close" onClick={onClose} title="Close settings">
          <X size={14} />
        </button>
      </div>

      <div className="chat-ai-settings-body">
        {/* 1. Provider Selection Chips */}
        <div className="settings-section">
          <label className="settings-label">Active Provider</label>
          <div className="provider-chips-row">
            {PROVIDERS.map((id) => {
              const isSelected = ai.provider === id
              const isReady = id === 'ollama' ? status?.online : stored[id as ByokProvider]
              return (
                <button
                  key={id}
                  type="button"
                  className={`chat-provider-chip ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelectProvider(id)}
                >
                  <span className={`provider-dot ${isReady ? 'online' : 'offline'}`} />
                  <span>{id === 'ollama' ? 'Ollama' : id === 'openai' ? 'OpenAI' : id === 'gemini' ? 'Gemini' : id === 'grok' ? 'Grok' : 'Claude'}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 2. Model Selection */}
        <div className="settings-section">
          <div className="settings-label-row">
            <label className="settings-label">Active Model</label>
            <span className="current-model-tag">{currentActiveModel}</span>
          </div>

          <div className="model-select-row">
            <select
              className="chat-select-field"
              value={currentActiveModel}
              onChange={(e) => handleSelectModel(e.target.value)}
            >
              {ai.provider === 'ollama' ? (
                ollamaModels.map((m) => (
                  <option key={m} value={m}>
                    {m} {status?.models?.includes(m) ? ' (installed)' : ''}
                  </option>
                ))
              ) : (
                byokModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Custom Model input so user is NEVER restricted to a hardcoded list */}
          <div className="custom-model-input-row">
            <input
              type="text"
              className="chat-input-field"
              placeholder={`Type any custom ${PROVIDER_LABELS[ai.provider]} model name...`}
              value={customModelDraft}
              onChange={(e) => setCustomModelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCustomModel()
              }}
            />
            <button
              type="button"
              className="chat-btn-small"
              onClick={handleSaveCustomModel}
              disabled={!customModelDraft.trim()}
              title="Apply custom model"
            >
              Apply
            </button>
          </div>
        </div>

        {/* 3. Temperature Radio Control */}
        <div className="settings-section">
          <div className="settings-label-row">
            <label className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Thermometer size={11} />
              <span>Temperature</span>
            </label>
            <span className="current-model-tag">
              {isTempLocked
                ? `${resolvedOpenAIProfile.idealTemperature.toFixed(1)} (Locked)`
                : currentTemp.toFixed(1)}
            </span>
          </div>

          <div className="temp-radio-grid" role="radiogroup" aria-label="AI Temperature">
            {TEMPERATURE_PRESETS.map((preset) => {
              const activeTemp = isTempLocked ? resolvedOpenAIProfile.idealTemperature : currentTemp
              const checked = Math.abs(activeTemp - preset.value) < 0.05
              return (
                <label
                  key={preset.id}
                  className={`temp-radio-card ${checked ? 'active' : ''} ${isTempLocked ? 'disabled' : ''}`}
                >
                  <input
                    type="radio"
                    name="chat-ai-temperature"
                    className="temp-radio-input"
                    value={preset.value}
                    checked={checked}
                    disabled={isTempLocked}
                    onChange={() => onChangeAI({ ...ai, temperature: preset.value })}
                  />
                  <span className="temp-radio-indicator" aria-hidden="true" />
                  <div className="temp-radio-content">
                    <div className="temp-radio-header">
                      <span className="temp-radio-label">{preset.label}</span>
                      <span className="temp-radio-val">{preset.value.toFixed(1)}</span>
                    </div>
                    <span className="temp-radio-desc">{preset.description}</span>
                  </div>
                </label>
              )
            })}
          </div>

          {ai.provider === 'openai' && (
            <div className="openai-ideal-banner">
              <div className="openai-ideal-info">
                {fetchingModelConfig ? (
                  <>
                    <Loader2 size={12} className="spin text-accent" />
                    <span>
                      Fetching ideal settings for <strong>{currentActiveModel}</strong>...
                    </span>
                  </>
                ) : (
                  <>
                    {isTempLocked ? (
                      <Lock size={12} className="text-accent" />
                    ) : (
                      <Sparkles size={12} className="text-accent" />
                    )}
                    <span>
                      Auto-configured <strong>{resolvedOpenAIProfile.model}</strong>:{' '}
                      {resolvedOpenAIProfile.summary}
                    </span>
                  </>
                )}
              </div>
              {!fetchingModelConfig &&
                !isTempLocked &&
                Math.abs(currentTemp - resolvedOpenAIProfile.idealTemperature) >= 0.05 && (
                  <button
                    type="button"
                    className="openai-ideal-reset-btn"
                    onClick={() =>
                      onChangeAI({
                        ...ai,
                        temperature: resolvedOpenAIProfile.idealTemperature,
                        openaiModelProfile: resolvedOpenAIProfile
                      })
                    }
                    title={`Reset to ideal temperature (${resolvedOpenAIProfile.idealTemperature.toFixed(1)})`}
                  >
                    <RotateCcw size={10} />
                    <span>Ideal ({resolvedOpenAIProfile.idealTemperature.toFixed(1)})</span>
                  </button>
                )}
            </div>
          )}
        </div>

        {/* 4. Provider Configuration Details */}
        {ai.provider === 'ollama' ? (
          <div className="settings-section provider-details-box">
            <div className="settings-label-row">
              <span className="settings-label">Ollama Host Address</span>
              <span className={`status-pill ${status?.online ? 'online' : 'offline'}`}>
                {checking ? (
                  <Loader2 size={10} className="spin" />
                ) : (
                  <span className={`status-indicator-dot ${status?.online ? 'online' : 'offline'}`} />
                )}
                {status?.online ? `Connected (${status.models?.length ?? 0} models)` : 'Offline'}
              </span>
            </div>
            <div className="host-input-row">
              <input
                type="text"
                className="chat-input-field"
                value={hostDraft}
                onChange={(e) => setHostDraft(e.target.value)}
                onBlur={() => {
                  onChangeAI({ ...ai, ollamaHost: hostDraft })
                  void recheckOllama(hostDraft)
                }}
                placeholder="http://localhost:11434"
              />
              <button
                type="button"
                className="chat-btn-small"
                onClick={() => {
                  onChangeAI({ ...ai, ollamaHost: hostDraft })
                  void recheckOllama(hostDraft, true)
                }}
                disabled={checking}
                title="Re-check connection"
              >
                <RefreshCw size={12} className={checking ? 'spin' : ''} />
                <span>Check</span>
              </button>
              {status?.online && !ai.configured && (
                <button
                  type="button"
                  className="chat-btn-small primary"
                  onClick={() => {
                    onChangeAI({ ...ai, provider: 'ollama', ollamaHost: hostDraft, configured: true })
                    notifyAiConfigChanged()
                    onToast?.('success', 'Ollama AI enabled')
                  }}
                >
                  Enable
                </button>
              )}
            </div>
            {status && !status.online && status.error && (
              <p className="settings-hint error">{status.error}</p>
            )}
          </div>
        ) : (
          <div className="settings-section provider-details-box">
            <div className="settings-label-row">
              <span className="settings-label">{PROVIDER_LABELS[ai.provider]} API Key</span>
              <span className={`status-pill ${stored[ai.provider as ByokProvider] ? 'online' : 'offline'}`}>
                {stored[ai.provider as ByokProvider] ? (
                  <>
                    <Check size={10} />
                    <span>Stored</span>
                  </>
                ) : (
                  <span>No key saved</span>
                )}
              </span>
            </div>
            <div className="api-key-input-row">
              <input
                type="password"
                className="chat-input-field"
                placeholder={
                  stored[ai.provider as ByokProvider]
                    ? '•••••••••••••••• (Replace key)'
                    : 'Paste API Key here...'
                }
                value={keyDrafts[ai.provider as ByokProvider]}
                onChange={(e) =>
                  setKeyDrafts((prev) => ({
                    ...prev,
                    [ai.provider as ByokProvider]: e.target.value
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveKey(ai.provider as ByokProvider)
                }}
              />
              <button
                type="button"
                className="chat-btn-small primary"
                onClick={() => void handleSaveKey(ai.provider as ByokProvider)}
                disabled={!keyDrafts[ai.provider as ByokProvider]?.trim()}
              >
                Save
              </button>
              {stored[ai.provider as ByokProvider] && (
                <button
                  type="button"
                  className="chat-btn-small danger"
                  onClick={() => void handleDeleteKey(ai.provider as ByokProvider)}
                  title="Remove key"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <p className="settings-hint">
              <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: 4 }} />
              {encryption === false
                ? 'Local encryption unavailable; keys stored in local memory.'
                : 'Keys are encrypted locally via OS safeStorage and never leave your machine.'}
            </p>
          </div>
        )}

        {/* 5. Zero-Config Built-in Internet Web Search */}
        <div className="settings-section provider-details-box">
          <div className="settings-label-row">
            <span className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Globe size={11} />
              <span>Internet Web Search</span>
            </span>
            <span className={`status-pill ${wsTestResult ? (wsTestResult.ok ? 'online' : 'offline') : ws.enabled ? 'online' : 'offline'}`}>
              <span
                className={`status-indicator-dot ${wsTestResult ? (wsTestResult.ok ? 'online' : 'offline') : ws.enabled ? 'online' : 'offline'}`}
              />
              {wsTestResult
                ? wsTestResult.ok
                  ? `${wsTestResult.provider} (${wsTestResult.results.length})`
                  : 'Offline'
                : ws.enabled
                  ? 'Built-in Ready'
                  : 'Disabled'}
            </span>
          </div>

          <div className="host-input-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="ws-check-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={ws.enabled}
                onChange={(e) =>
                  onChangeAI({
                    ...ai,
                    webSearch: { ...ws, enabled: e.target.checked }
                  })
                }
              />
              <span>Let agent search the internet</span>
            </label>
            <button
              type="button"
              className="chat-btn-small"
              disabled={wsTesting}
              onClick={async () => {
                if (!api?.testWebSearch) return
                const nextWs = { ...ws, searxngUrl: searxUrlDraft.trim() }
                onChangeAI({ ...ai, webSearch: nextWs })
                setWsTesting(true)
                try {
                  const res = await api.testWebSearch(nextWs)
                  setWsTestResult(res)
                  if (res.ok) {
                    onToast?.('success', `Web search ready (${res.provider}, ${res.results.length} hits)`)
                  } else {
                    onToast?.('error', res.error || 'Web search failed')
                  }
                } finally {
                  setWsTesting(false)
                }
              }}
              title="Test built-in internet search"
            >
              {wsTesting ? <Loader2 size={12} className="spin" /> : <Globe size={12} />}
              <span>Test</span>
            </button>
          </div>

          <p className="settings-hint" style={{ marginTop: 6 }}>
            Ready out of the box (no Docker/API keys). Uses built-in DuckDuckGo, Wikipedia, Stack Overflow, arXiv &amp; Hacker News.
          </p>

          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 700, opacity: 0.78 }}>
              Advanced: Custom SearXNG URL (optional)
            </summary>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="ws-check-row">
                <input
                  type="checkbox"
                  checked={ws.providerMode === 'searxng'}
                  onChange={(e) =>
                    onChangeAI({
                      ...ai,
                      webSearch: {
                        ...ws,
                        providerMode: e.target.checked ? 'searxng' : 'builtin',
                        searxngUrl: searxUrlDraft.trim()
                      }
                    })
                  }
                />
                <span>Use custom SearXNG instance</span>
              </label>
              {ws.providerMode === 'searxng' && (
                <input
                  type="text"
                  className="chat-input-field"
                  value={searxUrlDraft}
                  onChange={(e) => setSearxUrlDraft(e.target.value)}
                  onBlur={() =>
                    onChangeAI({
                      ...ai,
                      webSearch: { ...ws, searxngUrl: searxUrlDraft.trim() }
                    })
                  }
                  placeholder="https://your-searxng-instance.example"
                />
              )}
            </div>
          </details>

          {wsTestResult && !wsTestResult.ok && wsTestResult.error && (
            <p className="settings-hint error">{wsTestResult.error}</p>
          )}
        </div>
      </div>

      <div className="chat-ai-settings-footer">
        <button type="button" className="chat-settings-done-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
