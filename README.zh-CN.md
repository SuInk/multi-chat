# multi-chat

[English](README.md) | 简体中文

一个纯前端的多平台 AI 聊天应用，DeepSeek、OpenAI、Claude、Gemini，以及各种 OpenAI 兼容服务（OpenRouter、Ollama、sub2api 等中转），都能在同一个界面里用。不需要后端，浏览器直接请求你配置的接口；装成浏览器扩展后不受跨域限制。

本项目基于 DeepSeek 开源的 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 修改，并非 DeepSeek 官方项目。

## 和原版的区别

- **多平台**：在设置里可以添加多个平台，先选接入类型，再选服务平台，填上 API Key 就能用。点「获取模型列表」会拉取全部模型，可以点选，也可以打字筛选。
- **随时切换**：在输入框右下角切换平台和模型；同一个对话也能中途换，历史会自动转换成目标平台的格式。
- **深度思考**：五种协议都支持。服务端不认推理参数时，会自动去掉参数重发，并记住这个平台和模型。
- **附件**：在非 DeepSeek 平台上，图片和 PDF 直接内联进请求，文本文件按原文发送，不依赖 Files API。
- **浏览器扩展**：一条命令打包成 Chrome / Edge 扩展。扩展会按平台地址申请访问权限，不受跨域限制。
- DeepSeek 原有的能力全部保留：联网搜索、阅读链接、语音、文件上传、自动标题。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/SuInk/multi-chat.git
cd multi-chat
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 多平台

设置 → 模型平台 中可以添加多个平台，输入框右下角随时切换平台和模型。先选接入类型，再选服务平台；官方平台只需填 API Key，选「自定义地址」时才需要填接口地址。

| 协议 | 地址填法 | 说明 |
| --- | --- | --- |
| DeepSeek 扩展协议 | 根地址，如 `https://api.deepseek.com` | 原有全部能力：联网搜索、阅读链接、语音、Files API、自动标题 |
| OpenAI Chat Completions | 含版本段，如 `https://openrouter.ai/api/v1` | 绝大多数兼容服务、中转与本地 Ollama |
| OpenAI Responses | 含版本段，如 `https://api.openai.com/v1` | OpenAI 官方推荐接口 |
| Anthropic Messages | 根地址，如 `https://api.anthropic.com` | Claude 官方及 sub2api 等 Claude 中转 |
| Google Gemini 原生 | 根地址，如 `https://generativelanguage.googleapis.com` | Gemini 原生接口 |

- 非 DeepSeek 平台：只做标准对话，搜索、语音开关会隐藏；图片和 PDF 以 base64 内联，文本类附件按原文内联，其余格式只给出文件名；标题取首条提问。
- 深度思考开关对各协议分别折算（`reasoning_effort`、`reasoning`、`thinking`、`thinkingConfig`）；服务端不认时自动去掉参数重发，并记住该平台和模型，之后不再发送。
- 同一个对话可以中途换平台，历史会按目标协议转换；各家的思考内容与签名不跨轮回传。

### 跨域与浏览器扩展

网页版直接从浏览器请求接口，对方必须允许跨域（DeepSeek 官方允许，OpenAI、Gemini 等多数不允许）。用浏览器扩展版本可以绕开：

```sh
pnpm build:extension
```

在 Chrome / Edge 打开 `chrome://extensions`，开启开发者模式，「加载已解压的扩展程序」选择 `dist-extension/`，点击工具栏图标打开。扩展默认只能访问 `api.deepseek.com`；在模型平台中保存或获取模型列表时，会按该平台地址申请访问权限。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm build:extension` | 构建浏览器扩展到 `dist-extension/` |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
