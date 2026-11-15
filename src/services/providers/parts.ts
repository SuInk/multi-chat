import type { MessageParam } from '../api/types.js'

/** 非 DeepSeek 协议不经 Files API：附件在请求里内联，file_id 写成 local:<本地附件 id> */
export const LOCAL_FILE_PREFIX = 'local:'

export const isLocalFileId = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.startsWith(LOCAL_FILE_PREFIX)

export type LocalFile = { name: string; mimeType: string; isImage: boolean; blob: Blob }

/** 按 local:<id> 取本地原件；没有原件时返回 null */
export type FileLoader = (ref: string) => Promise<LocalFile | null>

/** 与协议无关的用户消息片段，各适配器再转成自己的格式 */
export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'pdf'; name: string; data: string }

export type NeutralMessage = { role: 'user'; parts: Part[] } | { role: 'assistant'; text: string }

/** 直接按文本内联的扩展名；其余非图片、非 PDF 附件只给出文件名提示 */
const TEXT_EXTS = new Set(
  (
    'txt md markdown json jsonl csv tsv xml yaml yml toml ini conf cfg log html htm css scss less ' +
    'js mjs cjs ts tsx jsx vue svelte py rb php java kt kts swift go rs c h cc cpp hpp cs m mm ' +
    'sh bash zsh ps1 bat sql r lua pl dart scala ex exs erl hs clj tex rst srt vtt env gitignore'
  ).split(' ')
)

/** 单个文本附件内联的最大字符数，避免一次把超大文件塞进上下文 */
const MAX_INLINE_TEXT = 200_000

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const toPart = async (file: LocalFile): Promise<Part> => {
  const ext = extOf(file.name)
  if (file.isImage) {
    return { type: 'image', mimeType: file.mimeType || 'image/png', data: await toBase64(file.blob) }
  }
  if (ext === 'pdf' || file.mimeType === 'application/pdf') {
    return { type: 'pdf', name: file.name, data: await toBase64(file.blob) }
  }
  if (file.mimeType.startsWith('text/') || TEXT_EXTS.has(ext)) {
    let text = await file.blob.text()
    if (text.length > MAX_INLINE_TEXT) {
      text = `${text.slice(0, MAX_INLINE_TEXT)}\n…（文件过长，已截断）`
    }
    return { type: 'text', text: `<file name="${file.name}">\n${text}\n</file>` }
  }
  return { type: 'text', text: `[附件 ${file.name}：当前平台不支持读取该格式]` }
}

/**
 * 把 toRequestMessages 产出的 Anthropic 风格消息转成中性格式：
 * latest_reminder 折进系统提示词（取最后一条），历史思考与服务端工具块丢弃，附件按 local: 引用读取。
 */
export const toNeutral = async (
  messages: MessageParam[],
  system: string,
  loadFile: FileLoader
): Promise<{ system: string; messages: NeutralMessage[] }> => {
  let reminder = ''
  const result: NeutralMessage[] = []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
      continue
    }
    if (message.role === 'assistant') {
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
      result.push({ role: 'assistant', text })
      continue
    }
    if (typeof message.content === 'string') {
      result.push({ role: 'user', parts: [{ type: 'text', text: message.content }] })
      continue
    }
    const parts: Part[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text })
        continue
      }
      const file = await loadFile(block.source.file_id)
      if (file) {
        parts.push(await toPart(file))
      }
    }
    result.push({ role: 'user', parts: parts.length > 0 ? parts : [{ type: 'text', text: ' ' }] })
  }
  const context = reminder
    ? `当前环境信息（日期,星期,地点,平台,语言）：${reminder}`
    : ''
  return { system: [system, context].filter(Boolean).join('\n\n'), messages: result }
}
