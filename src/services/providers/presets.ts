import type { Protocol } from './types.js'

/**
 * 两级选择：先定接入类型（用哪套协议说话），再定服务平台（找谁要服务）。
 * OpenAI 兼容接口下另有 Chat / Responses 两种接口模式，其余类型协议唯一。
 */
export type ProviderKind = 'deepseek' | 'openai' | 'anthropic' | 'gemini'

export const PROVIDER_KINDS: { id: ProviderKind; label: string; hint: string }[] = [
  { id: 'deepseek', label: 'DeepSeek', hint: '支持搜索、读链接、语音和文件上传' },
  { id: 'openai', label: 'OpenAI 兼容接口', hint: '绝大多数服务商、中转和本地模型都提供这套协议' },
  { id: 'anthropic', label: 'Anthropic 原生', hint: '直连 Claude Messages API，sub2api 等中转也走这个' },
  { id: 'gemini', label: 'Google Gemini 原生', hint: '直连 Gemini API' },
]

export type ProviderPreset = {
  id: string
  label: string
  kind: ProviderKind
  /** OpenAI 兼容下的推荐接口模式；其余类型由 kind 决定 */
  protocol: Protocol
  /** 空串表示自定义地址，需要用户填写 */
  baseUrl: string
  models: string[]
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek 官方',
    kind: 'deepseek',
    protocol: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'openai',
    label: 'OpenAI 官方',
    kind: 'openai',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama（本机）',
    kind: 'openai',
    protocol: 'openai-chat',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
  },
  { id: 'openai-custom', label: '自定义地址', kind: 'openai', protocol: 'openai-chat', baseUrl: '', models: [] },
  {
    id: 'anthropic',
    label: 'Anthropic 官方',
    kind: 'anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  { id: 'anthropic-custom', label: '自定义地址', kind: 'anthropic', protocol: 'anthropic', baseUrl: '', models: [] },
  {
    id: 'gemini',
    label: 'Google 官方',
    kind: 'gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: [],
  },
  { id: 'gemini-custom', label: '自定义地址', kind: 'gemini', protocol: 'gemini', baseUrl: '', models: [] },
]

export const kindOf = (protocol: Protocol): ProviderKind =>
  protocol === 'openai-chat' || protocol === 'openai-responses' ? 'openai' : protocol

export const presetsForKind = (kind: ProviderKind) =>
  PROVIDER_PRESETS.filter((preset) => preset.kind === kind)

export const isCustomPreset = (preset: ProviderPreset) => preset.baseUrl === ''

/** 按已保存的配置反查服务平台；地址对不上任何预设就落到该类型的自定义项 */
export const detectPreset = (protocol: Protocol, baseUrl: string): ProviderPreset => {
  const candidates = presetsForKind(kindOf(protocol))
  const normalized = baseUrl.replace(/\/+$/, '')
  return (
    candidates.find((preset) => preset.baseUrl !== '' && preset.baseUrl === normalized) ??
    candidates.find(isCustomPreset) ??
    candidates[0]
  )
}

/** 平台名称不用手填：官方预设用预设名，自定义地址用域名 */
export const providerName = (preset: ProviderPreset, baseUrl: string) => {
  if (!isCustomPreset(preset)) {
    return preset.label
  }
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** 首次启动内置的 DeepSeek 平台 id，旧版本保存的 API Key 迁移到这里 */
export const BUILTIN_DEEPSEEK_ID = 'deepseek'
