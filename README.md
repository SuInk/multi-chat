# multi-chat

English | [简体中文](README.zh-CN.md)

A frontend-only, multi-provider AI chat app. Use DeepSeek, OpenAI, Claude, Gemini, and OpenAI-compatible services (OpenRouter, Ollama, relays such as sub2api) from one interface. There is no backend: the browser talks directly to the APIs you configure, and the browser-extension build is not limited by CORS.

Based on DeepSeek's open-source [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). This is not an official DeepSeek project.

## What's different

- **Multiple providers**: add providers in Settings by picking a provider type and a service, then entering an API key. "Fetch models" lists every available model; click to pick one or type to filter.
- **Switch any time**: change provider and model from the input box, even mid-conversation; history is converted to the target protocol.
- **Deep thinking** on all five protocols (DeepSeek, OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini). If a service rejects reasoning parameters, the request is retried without them and the provider/model pair is remembered.
- **Attachments** on non-DeepSeek providers: images and PDFs are inlined, text files are sent as text; no Files API needed.
- **Browser extension**: `pnpm build:extension` produces a Chrome / Edge extension that requests host access per provider, so CORS is not an issue.
- All original DeepSeek features are kept: web search, link reading, speech, file uploads, and automatic titles.

To load the extension, open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select `dist-extension/`.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/SuInk/multi-chat.git
cd multi-chat
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm build:extension` | Build the browser extension into `dist-extension/` |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
