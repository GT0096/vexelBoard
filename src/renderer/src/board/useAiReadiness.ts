import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BYOK_PROVIDERS,
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_LABELS,
  type ByokProvider
} from '@shared/ipc'
import type { AISettings } from '../types/board'

const AI_CONFIG_EVENT = 'vexelboard:ai-config-changed'
const AI_CONFIG_REV_KEY = 'vgb.aiConfigRevision'

export function notifyAiConfigChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AI_CONFIG_EVENT))
  try {
    localStorage.setItem(AI_CONFIG_REV_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

export interface AiReadinessState {
  isAiConfigured: boolean
  checking: boolean
  reason: string
  ollamaOnline: boolean
  storedKeys: Record<ByokProvider, boolean>
  refresh: () => Promise<void>
}

const EMPTY_KEYS: Record<ByokProvider, boolean> = {
  openai: false,
  gemini: false,
  grok: false,
  claude: false
}

async function probeAiStatus(
  provider: AISettings['provider'],
  configured: boolean | undefined,
  ollamaHost: string
): Promise<{ storedKeys: Record<ByokProvider, boolean>; ollamaOnline: boolean }> {
  const api = typeof window !== 'undefined' ? window.glassAPI : undefined
  if (!api) {
    return { storedKeys: EMPTY_KEYS, ollamaOnline: false }
  }

  try {
    const keyResults = await Promise.all(BYOK_PROVIDERS.map((id) => api.hasKey(id)))
    const storedKeys: Record<ByokProvider, boolean> = {
      openai: Boolean(keyResults[0]),
      gemini: Boolean(keyResults[1]),
      grok: Boolean(keyResults[2]),
      claude: Boolean(keyResults[3])
    }

    let ollamaOnline = false
    if (provider === 'ollama' && configured && ollamaHost.trim()) {
      try {
        const status = await api.checkOllama(ollamaHost.trim())
        ollamaOnline = Boolean(status?.online)
      } catch {
        ollamaOnline = false
      }
    }

    return { storedKeys, ollamaOnline }
  } catch {
    return { storedKeys: EMPTY_KEYS, ollamaOnline: false }
  }
}

export function useAiReadiness(ai: AISettings): AiReadinessState {
  const [storedKeys, setStoredKeys] = useState<Record<ByokProvider, boolean>>(EMPTY_KEYS)
  const [ollamaOnline, setOllamaOnline] = useState(false)
  const [checking, setChecking] = useState(true)

  const refresh = useCallback(async () => {
    const res = await probeAiStatus(ai.provider, ai.configured, ai.ollamaHost)
    setStoredKeys(res.storedKeys)
    setOllamaOnline(res.ollamaOnline)
    setChecking(false)
  }, [ai.provider, ai.configured, ai.ollamaHost])

  useEffect(() => {
    let active = true
    void probeAiStatus(ai.provider, ai.configured, ai.ollamaHost).then((res) => {
      if (!active) return
      setStoredKeys(res.storedKeys)
      setOllamaOnline(res.ollamaOnline)
      setChecking(false)
    })
    return () => {
      active = false
    }
  }, [
    ai.provider,
    ai.configured,
    ai.ollamaHost,
    ai.ollamaModel,
    ai.byokModels.openai,
    ai.byokModels.gemini,
    ai.byokModels.grok,
    ai.byokModels.claude
  ])

  useEffect(() => {
    const onCustom = (): void => {
      void refresh()
    }
    const onStorage = (e: StorageEvent): void => {
      if (e.key === AI_CONFIG_REV_KEY || e.key === 'vgb.settings') {
        void refresh()
      }
    }
    window.addEventListener(AI_CONFIG_EVENT, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(AI_CONFIG_EVENT, onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [refresh])

  const { isAiConfigured, reason } = useMemo(() => {
    if (typeof window === 'undefined' || !window.glassAPI) {
      return { isAiConfigured: false, reason: 'Configure AI Settings to enable AI features.' }
    }

    if (ai.provider === 'ollama') {
      if (!ai.configured) {
        return {
          isAiConfigured: false,
          reason: 'Configure AI Settings (Ollama or a Cloud API key) to enable AI features.'
        }
      }
      if (!ai.ollamaHost.trim()) {
        return {
          isAiConfigured: false,
          reason: 'Enter an Ollama host URL in AI Settings to enable AI features.'
        }
      }
      if (!ai.ollamaModel.trim()) {
        return {
          isAiConfigured: false,
          reason: 'Select an Ollama model in AI Settings to enable AI features.'
        }
      }
      if (!ollamaOnline) {
        return {
          isAiConfigured: false,
          reason:
            'Ollama is offline. Start Ollama and click Re-check in AI Settings, or add a Cloud API key.'
        }
      }
      return { isAiConfigured: true, reason: '' }
    }

    const byok = ai.provider as ByokProvider
    const hasKey = storedKeys[byok]
    const activeModel = (ai.byokModels?.[byok] || DEFAULT_PROVIDER_MODELS[byok] || '').trim()
    if (!hasKey) {
      return {
        isAiConfigured: false,
        reason: `Save a ${PROVIDER_LABELS[byok]} API key in AI Settings to enable AI features.`
      }
    }
    if (!activeModel) {
      return {
        isAiConfigured: false,
        reason: `Enter a ${PROVIDER_LABELS[byok]} model ID in AI Settings to enable AI features.`
      }
    }
    return { isAiConfigured: true, reason: '' }
  }, [
    ai.provider,
    ai.configured,
    ai.ollamaHost,
    ai.ollamaModel,
    ai.byokModels,
    ollamaOnline,
    storedKeys
  ])

  return {
    isAiConfigured,
    checking,
    reason,
    ollamaOnline,
    storedKeys,
    refresh
  }
}
