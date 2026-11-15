import type { MessageStreamEvent, MessageUsage, StopReason } from '../api/types.js'

/**
 * 把各家「一段段文字 / 推理增量」折成应用内部使用的 Anthropic 风格事件：
 * 同类增量合并在同一个内容块里，类型切换时先关闭上一个块再开新块。
 */
export class EventBuilder {
  private index = -1
  private current: 'text' | 'thinking' | null = null
  private started = false
  stopReason: StopReason | null = null
  usage: MessageUsage | undefined

  start(id: string, model: string): MessageStreamEvent[] {
    if (this.started) {
      return []
    }
    this.started = true
    return [{ type: 'message_start', message: { id, model } }]
  }

  private open(kind: 'text' | 'thinking'): MessageStreamEvent[] {
    if (this.current === kind) {
      return []
    }
    const events = this.close()
    this.index += 1
    this.current = kind
    events.push({
      type: 'content_block_start',
      index: this.index,
      content_block:
        kind === 'text'
          ? { type: 'text', text: '' }
          : { type: 'thinking', thinking: '', signature: '' },
    })
    return events
  }

  close(): MessageStreamEvent[] {
    if (this.current === null) {
      return []
    }
    this.current = null
    return [{ type: 'content_block_stop', index: this.index }]
  }

  text(text: string): MessageStreamEvent[] {
    if (!text) {
      return []
    }
    return [
      ...this.start('', ''),
      ...this.open('text'),
      { type: 'content_block_delta', index: this.index, delta: { type: 'text_delta', text } },
    ]
  }

  thinking(thinking: string): MessageStreamEvent[] {
    if (!thinking) {
      return []
    }
    return [
      ...this.start('', ''),
      ...this.open('thinking'),
      {
        type: 'content_block_delta',
        index: this.index,
        delta: { type: 'thinking_delta', thinking },
      },
    ]
  }

  /** 收尾：关闭当前块，补齐 message_delta 与 message_stop */
  finish(): MessageStreamEvent[] {
    return [
      ...this.start('', ''),
      ...this.close(),
      {
        type: 'message_delta',
        delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null },
        usage: this.usage,
      },
      { type: 'message_stop' },
    ]
  }
}

export const toUsage = (input: number, output: number, cached = 0): MessageUsage => ({
  input_tokens: Math.max(0, input - cached),
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: cached,
  output_tokens: output,
})
