import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { BUILTIN_DEEPSEEK_ID } from './providers/presets.js'
import { PROTOCOLS, type ProviderConfig } from './providers/types.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  /** 当前平台的 API Key，由 providers 与 activeProviderId 派生，便于旧代码判断是否已配置 */
  apiKey: string | null
  providers: ProviderConfig[]
  activeProviderId: string
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  providers: 'chat-demo:providers',
  activeProvider: 'chat-demo:active-provider',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const defaultDeepSeek = (apiKey: string): ProviderConfig => ({
  id: BUILTIN_DEEPSEEK_ID,
  name: 'DeepSeek',
  protocol: 'deepseek',
  baseUrl: __API_ORIGIN__,
  apiKey,
  model: 'deepseek-flash',
  models: ['deepseek-flash', 'deepseek-v4-pro'],
})

const isProvider = (value: unknown): value is ProviderConfig => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    PROTOCOLS.includes(item.protocol as ProviderConfig['protocol']) &&
    typeof item.baseUrl === 'string' &&
    typeof item.apiKey === 'string' &&
    typeof item.model === 'string' &&
    Array.isArray(item.models) &&
    item.models.every((model) => typeof model === 'string')
  )
}

/** 读取平台列表；没有保存过时内置 DeepSeek，并迁移旧版本单独保存的 API Key */
const initialProviders = (): ProviderConfig[] => {
  try {
    const saved: unknown = JSON.parse(read(KEYS.providers) ?? 'null')
    if (Array.isArray(saved)) {
      const providers = saved.filter(isProvider)
      if (providers.length > 0) {
        return providers
      }
    }
  } catch {
    // 解析失败按未保存处理
  }
  return [defaultDeepSeek(read(KEYS.apiKey) ?? '')]
}

const deriveActive = (providers: ProviderConfig[], activeProviderId: string | null) => {
  const active = providers.find((item) => item.id === activeProviderId) ?? providers[0]
  return { activeProviderId: active.id, apiKey: active.apiKey || null }
}

const initialProviderState = () => {
  const providers = initialProviders()
  return { providers, ...deriveActive(providers, read(KEYS.activeProvider)) }
}

export const useSettings = create<Settings>(() => ({
  ...initialProviderState(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

/** 当前选中的平台；列表至少有一项 */
export const getActiveProvider = (state: Pick<Settings, 'providers' | 'activeProviderId'> = useSettings.getState()) =>
  state.providers.find((item) => item.id === state.activeProviderId) ?? state.providers[0]

const commitProviders = (providers: ProviderConfig[], activeProviderId: string) => {
  write(KEYS.providers, JSON.stringify(providers))
  const next = deriveActive(providers, activeProviderId)
  write(KEYS.activeProvider, next.activeProviderId)
  useSettings.setState({ providers, ...next })
}

/** 新增或按 id 替换平台 */
export const saveProvider = (provider: ProviderConfig) => {
  const { providers, activeProviderId } = useSettings.getState()
  const exists = providers.some((item) => item.id === provider.id)
  commitProviders(
    exists
      ? providers.map((item) => (item.id === provider.id ? provider : item))
      : [...providers, provider],
    activeProviderId
  )
}

/** 删除平台；至少保留一个 */
export const removeProvider = (id: string) => {
  const { providers, activeProviderId } = useSettings.getState()
  if (providers.length <= 1) {
    return
  }
  commitProviders(
    providers.filter((item) => item.id !== id),
    activeProviderId === id ? '' : activeProviderId
  )
}

/** 切换当前平台，可同时切换该平台的模型 */
export const selectProvider = (id: string, model?: string) => {
  const { providers } = useSettings.getState()
  commitProviders(
    model === undefined
      ? providers
      : providers.map((item) => (item.id === id ? { ...item, model } : item)),
    id
  )
}

/** 更新当前平台的 API Key */
export const setApiKey = (apiKey: string | null) => {
  const active = getActiveProvider()
  saveProvider({ ...active, apiKey: apiKey ?? '' })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
