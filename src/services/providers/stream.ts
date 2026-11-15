import { ApiError, request } from '../api/client.js'
import { readMessageEvent } from '../api/parseEvent.js'
import { readServerSentEvents } from '../api/sse.js'
import type { MessageParam, MessageStreamEvent, StopReason } from '../api/types.js'
import { EventBuilder, toUsage } from './events.js'
import { toNeutral, type FileLoader, type NeutralMessage, type Part } from './parts.js'
import type { ProviderConfig } from './types.js'

export type ChatInput = {
  provider: ProviderConfig
  model: string
  system: string
  /** toRequestMessages 的结果，附件以 local:<id> 引用 */
  messages: MessageParam[]
  thinking: boolean
  loadFile: FileLoader
  signal: AbortSignal
}

const trimSlash = (url: string) => url.trim().replace(/\/+$/, '')

/** Anthropic、Gemini 填根地址；用户多写了版本段时不重复拼接 */
const joinVersioned = (base: string, version: string, path: string) => {
  const root = trimSlash(base)
  return root.endsWith(`/${version}`) ? `${root}${path}` : `${root}/${version}${path}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// ---------- 思考参数降级 ----------
// 不同服务对推理参数的支持参差不齐：被拒时去掉参数重发一次，并按「平台 + 模型」记住，下次不再发送。

const DOWNGRADE_KEY = 'chat-demo:reasoning-downgrade'
const downgraded = new Set<string>(
  (() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(DOWNGRADE_KEY) ?? '[]')
      return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : []
    } catch {
      return []
    }
  })()
)

const downgradeKey = (input: ChatInput) => `${input.provider.id}\n${input.model}`

const rememberDowngrade = (input: ChatInput) => {
  downgraded.add(downgradeKey(input))
  try {
    localStorage.setItem(DOWNGRADE_KEY, JSON.stringify([...downgraded]))
  } catch {
    // 存储不可用时只在本次页面内生效
  }
}

const REASONING_MARKERS = [
  'reasoning',
  'thinking',
  'effort',
  'budget_tokens',
  'thinkingconfig',
  'stream_options',
]

const isReasoningRejected = (error: unknown) =>
  error instanceof ApiError &&
  error.kind === 'http' &&
  (error.status === 400 || error.status === 422) &&
  REASONING_MARKERS.some((marker) => error.message.toLowerCase().includes(marker))

/** 先带推理参数发请求，被拒绝时去掉参数重发 */
const postWithDowngrade = async (
  input: ChatInput,
  url: string,
  headers: Record<string, string>,
  body: (withReasoning: boolean) => unknown
): Promise<Response> => {
  const send = (withReasoning: boolean) =>
    request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body(withReasoning)),
      signal: input.signal,
    })
  if (downgraded.has(downgradeKey(input))) {
    return send(false)
  }
  try {
    return await send(true)
  } catch (error) {
    if (!isReasoningRejected(error)) {
      throw error
    }
    rememberDowngrade(input)
    return send(false)
  }
}

/** 逐个产出 SSE 的 JSON 数据；[DONE] 与无法解析的帧跳过，错误帧抛出 */
async function* readJsonEvents(response: Response, signal: AbortSignal) {
  if (!response.body) {
    throw new ApiError('protocol', '')
  }
  for await (const { event, data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      return
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      throw new ApiError('stream', payload.error.message)
    }
    yield { event, payload }
  }
}

// ---------- OpenAI Chat Completions ----------

const dataUrl = (mimeType: string, data: string) => `data:${mimeType};base64,${data}`

const toOpenAIChatContent = (parts: Part[]) =>
  parts.every((part) => part.type === 'text')
    ? parts.map((part) => part.text).join('\n\n')
    : parts.map((part) => {
        switch (part.type) {
          case 'text':
            return { type: 'text', text: part.text }
          case 'image':
            return { type: 'image_url', image_url: { url: dataUrl(part.mimeType, part.data) } }
          case 'pdf':
            return {
              type: 'file',
              file: { filename: part.name, file_data: dataUrl('application/pdf', part.data) },
            }
        }
      })

const OPENAI_FINISH: Record<string, StopReason> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
}

async function* streamOpenAIChat(
  input: ChatInput,
  system: string,
  messages: NeutralMessage[]
): AsyncGenerator<MessageStreamEvent> {
  const response = await postWithDowngrade(
    input,
    `${trimSlash(input.provider.baseUrl)}/chat/completions`,
    { Authorization: `Bearer ${input.provider.apiKey}` },
    (withReasoning) => ({
      model: input.model,
      stream: true,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages.map((message) =>
          message.role === 'user'
            ? { role: 'user', content: toOpenAIChatContent(message.parts) }
            : { role: 'assistant', content: message.text }
        ),
      ],
      ...(withReasoning
        ? {
            stream_options: { include_usage: true },
            ...(input.thinking ? { reasoning_effort: 'high' } : {}),
          }
        : {}),
    })
  )
  const builder = new EventBuilder()
  let finished = false
  for await (const { payload } of readJsonEvents(response, input.signal)) {
    if (!isRecord(payload)) {
      continue
    }
    yield* builder.start(str(payload.id), str(payload.model) || input.model)
    if (isRecord(payload.usage)) {
      const usage = payload.usage
      const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {}
      builder.usage = toUsage(
        num(usage.prompt_tokens),
        num(usage.completion_tokens),
        num(details.cached_tokens) || num(usage.prompt_cache_hit_tokens)
      )
    }
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
    if (!isRecord(choice)) {
      continue
    }
    const delta = isRecord(choice.delta) ? choice.delta : {}
    // 各家推理字段名不同：DeepSeek / Qwen 用 reasoning_content，OpenRouter 用 reasoning
    for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
      yield* builder.thinking(str(delta[key]))
    }
    yield* builder.text(str(delta.content))
    const finish = str(choice.finish_reason)
    if (finish) {
      builder.stopReason = OPENAI_FINISH[finish] ?? 'end_turn'
      finished = true
    }
  }
  if (!finished) {
    throw new ApiError('interrupted', '')
  }
  yield* builder.finish()
}

// ---------- OpenAI Responses ----------

const toResponsesContent = (parts: Part[]) =>
  parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'input_text', text: part.text }
      case 'image':
        return { type: 'input_image', image_url: dataUrl(part.mimeType, part.data) }
      case 'pdf':
        return {
          type: 'input_file',
          filename: part.name,
          file_data: dataUrl('application/pdf', part.data),
        }
    }
  })

async function* streamOpenAIResponses(
  input: ChatInput,
  system: string,
  messages: NeutralMessage[]
): AsyncGenerator<MessageStreamEvent> {
  const response = await postWithDowngrade(
    input,
    `${trimSlash(input.provider.baseUrl)}/responses`,
    { Authorization: `Bearer ${input.provider.apiKey}` },
    (withReasoning) => ({
      model: input.model,
      stream: true,
      store: false,
      ...(system ? { instructions: system } : {}),
      input: messages.map((message) =>
        message.role === 'user'
          ? { role: 'user', content: toResponsesContent(message.parts) }
          : { role: 'assistant', content: [{ type: 'output_text', text: message.text }] }
      ),
      ...(withReasoning && input.thinking
        ? { reasoning: { effort: 'high', summary: 'auto' } }
        : {}),
    })
  )
  const builder = new EventBuilder()
  let finished = false
  for await (const { event, payload } of readJsonEvents(response, input.signal)) {
    if (!isRecord(payload)) {
      continue
    }
    const type = str(payload.type) || event
    const result = isRecord(payload.response) ? payload.response : {}
    switch (type) {
      case 'response.created':
        yield* builder.start(str(result.id), str(result.model) || input.model)
        break
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        yield* builder.thinking(str(payload.delta))
        break
      case 'response.reasoning_summary_part.done':
        yield* builder.thinking('\n\n')
        break
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        yield* builder.text(str(payload.delta))
        break
      case 'response.completed':
      case 'response.incomplete': {
        const usage = isRecord(result.usage) ? result.usage : {}
        const details = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {}
        builder.usage = toUsage(
          num(usage.input_tokens),
          num(usage.output_tokens),
          num(details.cached_tokens)
        )
        const incomplete = isRecord(result.incomplete_details) ? result.incomplete_details : {}
        builder.stopReason =
          type === 'response.incomplete' && incomplete.reason === 'max_output_tokens'
            ? 'max_tokens'
            : 'end_turn'
        finished = true
        break
      }
      case 'response.failed': {
        const error = isRecord(result.error) ? result.error : {}
        throw new ApiError('stream', str(error.message))
      }
      case 'error':
        throw new ApiError('stream', str(payload.message))
      default:
        break
    }
    if (finished) {
      break
    }
  }
  if (!finished) {
    throw new ApiError('interrupted', '')
  }
  yield* builder.finish()
}

// ---------- Anthropic Messages ----------

const ANTHROPIC_HEADERS = (apiKey: string): Record<string, string> => ({
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  // 浏览器直连 Anthropic 必须显式声明，否则带 Origin 的请求会被拒绝
  'anthropic-dangerous-direct-browser-access': 'true',
})

const MAX_TOKENS = 32_000
const THINKING_BUDGET = 16_000

const toAnthropicContent = (parts: Part[]) =>
  parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text }
      case 'image':
        return {
          type: 'image',
          source: { type: 'base64', media_type: part.mimeType, data: part.data },
        }
      case 'pdf':
        return {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: part.data },
        }
    }
  })

async function* streamAnthropic(
  input: ChatInput,
  system: string,
  messages: NeutralMessage[]
): AsyncGenerator<MessageStreamEvent> {
  const last = messages.length - 1
  const response = await postWithDowngrade(
    input,
    joinVersioned(input.provider.baseUrl, 'v1', '/messages'),
    { ...ANTHROPIC_HEADERS(input.provider.apiKey), Accept: 'text/event-stream' },
    (withReasoning) => ({
      model: input.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      ...(system ? { system } : {}),
      messages: messages.map((message, index) =>
        message.role === 'user'
          ? { role: 'user', content: toAnthropicContent(message.parts) }
          : {
              role: 'assistant',
              // 预填续写时末尾不能是空白
              content: [
                { type: 'text', text: index === last ? message.text.trimEnd() : message.text },
              ],
            }
      ),
      ...(withReasoning && input.thinking
        ? { thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET } }
        : {}),
    })
  )
  if (!response.body) {
    throw new ApiError('protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(
    response.body,
    input.signal
  )) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (eventName === 'error' || (isRecord(payload) && isRecord(payload.error))) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {}
      throw new ApiError('stream', str(error.message) || data)
    }
    const event = readMessageEvent(payload)
    if (event) {
      yield event
      if (event.type === 'message_stop') {
        return
      }
    }
  }
  throw new ApiError('interrupted', '')
}

// ---------- Google Gemini ----------

const GEMINI_FINISH: Record<string, StopReason> = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'refusal',
  PROHIBITED_CONTENT: 'refusal',
  BLOCKLIST: 'refusal',
  SPII: 'refusal',
}

const toGeminiParts = (parts: Part[]) =>
  parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { text: part.text }
      case 'image':
        return { inline_data: { mime_type: part.mimeType, data: part.data } }
      case 'pdf':
        return { inline_data: { mime_type: 'application/pdf', data: part.data } }
    }
  })

async function* streamGemini(
  input: ChatInput,
  system: string,
  messages: NeutralMessage[]
): AsyncGenerator<MessageStreamEvent> {
  const response = await postWithDowngrade(
    input,
    `${joinVersioned(input.provider.baseUrl, 'v1beta', `/models/${encodeURIComponent(input.model)}`)}:streamGenerateContent?alt=sse`,
    { 'x-goog-api-key': input.provider.apiKey },
    (withReasoning) => ({
      contents: messages.map((message) =>
        message.role === 'user'
          ? { role: 'user', parts: toGeminiParts(message.parts) }
          : { role: 'model', parts: [{ text: message.text }] }
      ),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(withReasoning && input.thinking
        ? { generationConfig: { thinkingConfig: { includeThoughts: true } } }
        : {}),
    })
  )
  const builder = new EventBuilder()
  let finished = false
  for await (const { payload } of readJsonEvents(response, input.signal)) {
    if (!isRecord(payload)) {
      continue
    }
    yield* builder.start(str(payload.responseId), str(payload.modelVersion) || input.model)
    if (isRecord(payload.usageMetadata)) {
      const usage = payload.usageMetadata
      builder.usage = toUsage(
        num(usage.promptTokenCount),
        num(usage.candidatesTokenCount) + num(usage.thoughtsTokenCount),
        num(usage.cachedContentTokenCount)
      )
    }
    if (isRecord(payload.promptFeedback) && payload.promptFeedback.blockReason) {
      builder.stopReason = 'refusal'
      finished = true
      continue
    }
    const candidate = Array.isArray(payload.candidates) ? payload.candidates[0] : undefined
    if (!isRecord(candidate)) {
      continue
    }
    const content = isRecord(candidate.content) ? candidate.content : {}
    for (const part of Array.isArray(content.parts) ? content.parts : []) {
      if (!isRecord(part)) {
        continue
      }
      if (part.thought === true) {
        yield* builder.thinking(str(part.text))
      } else {
        yield* builder.text(str(part.text))
      }
    }
    const finish = str(candidate.finishReason)
    if (finish) {
      builder.stopReason = GEMINI_FINISH[finish] ?? 'end_turn'
      finished = true
    }
  }
  if (!finished) {
    throw new ApiError('interrupted', '')
  }
  yield* builder.finish()
}

// ---------- 入口 ----------

/** 非 DeepSeek 协议的统一入口：产出与 DeepSeek 相同结构的流式事件，以 message_stop 结束 */
export async function* streamChat(input: ChatInput): AsyncGenerator<MessageStreamEvent> {
  const { system, messages } = await toNeutral(input.messages, input.system, input.loadFile)
  switch (input.provider.protocol) {
    case 'openai-chat':
      yield* streamOpenAIChat(input, system, messages)
      return
    case 'openai-responses':
      yield* streamOpenAIResponses(input, system, messages)
      return
    case 'anthropic':
      yield* streamAnthropic(input, system, messages)
      return
    case 'gemini':
      yield* streamGemini(input, system, messages)
      return
    case 'deepseek':
      throw new Error('DeepSeek 扩展协议走 streamMessage')
  }
}

/** 拉取模型列表，同时用来校验地址与 API Key */
export const listModels = async (
  provider: Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey'>,
  signal?: AbortSignal
): Promise<string[]> => {
  const base = trimSlash(provider.baseUrl)
  let url: string
  let headers: Record<string, string>
  switch (provider.protocol) {
    case 'anthropic':
      url = joinVersioned(base, 'v1', '/models?limit=1000')
      headers = ANTHROPIC_HEADERS(provider.apiKey)
      break
    case 'gemini':
      url = joinVersioned(base, 'v1beta', '/models?pageSize=1000')
      headers = { 'x-goog-api-key': provider.apiKey }
      break
    default:
      url = `${base}/models`
      headers = { Authorization: `Bearer ${provider.apiKey}` }
  }
  const response = await request(url, { method: 'GET', headers, signal })
  const body: unknown = await response.json().catch(() => null)
  if (!isRecord(body)) {
    throw new ApiError('protocol', '')
  }
  if (provider.protocol === 'gemini') {
    return (Array.isArray(body.models) ? body.models : [])
      .filter(
        (model): model is Record<string, unknown> =>
          isRecord(model) &&
          (!Array.isArray(model.supportedGenerationMethods) ||
            model.supportedGenerationMethods.includes('generateContent'))
      )
      .map((model) => str(model.name).replace(/^models\//, ''))
      .filter(Boolean)
  }
  return (Array.isArray(body.data) ? body.data : [])
    .map((model) => (isRecord(model) ? str(model.id) : ''))
    .filter(Boolean)
}
