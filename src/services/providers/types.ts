/**
 * 多平台接入。参照「协议」与「服务商」分两级的做法：
 * 协议决定用哪套格式跟模型说话，服务商预设只负责预填地址。
 * deepseek 是 DeepSeek 扩展协议（Anthropic 兼容 + 搜索、读链接、语音、文件等私有能力），
 * 其余协议只做标准对话。
 */
export type Protocol = 'deepseek' | 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini'

export type ProviderConfig = {
  id: string
  name: string
  protocol: Protocol
  /** 不带结尾斜杠；OpenAI 系协议包含版本段（如 /v1），Anthropic 与 Gemini 为根地址 */
  baseUrl: string
  apiKey: string
  /** 当前选用的模型 */
  model: string
  /** 可选模型；可从接口拉取，也可手填 */
  models: string[]
}

/** 各协议能用的功能；界面按此显示或隐藏开关 */
export type ProviderCapabilities = {
  /** 联网搜索与阅读链接 */
  search: boolean
  /** 语音输入与朗读 */
  speech: boolean
  /** 附件经 Files API 上传；否则在请求里内联 */
  remoteFiles: boolean
  /** 服务端生成标题 */
  serverTitle: boolean
  /** 末尾 assistant 预填续写；thinking 表示开启思考时是否也可以 */
  prefill: { plain: boolean; thinking: boolean }
}

export const getCapabilities = (protocol: Protocol): ProviderCapabilities => {
  if (protocol === 'deepseek') {
    return {
      search: true,
      speech: true,
      remoteFiles: true,
      serverTitle: true,
      prefill: { plain: true, thinking: true },
    }
  }
  return {
    search: false,
    speech: false,
    remoteFiles: false,
    serverTitle: false,
    prefill: { plain: protocol === 'anthropic', thinking: false },
  }
}

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  deepseek: 'DeepSeek 扩展协议',
  'openai-chat': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
  anthropic: 'Anthropic Messages',
  gemini: 'Google Gemini 原生',
}

export const PROTOCOLS = Object.keys(PROTOCOL_LABELS) as Protocol[]
