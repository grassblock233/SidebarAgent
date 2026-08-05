<p align="center">
  <img src="assets/logo-source.png" width="160" alt="SidebarAgent Logo">
</p>

<h1 align="center">SidebarAgent</h1>

一个使用 Vite、React 和 TypeScript 构建的 Chrome / Edge Manifest V3 扩展。它支持直接对话，也可以将网页选中文字或当前视口内的可见 DOM 文字送入侧边栏，并使用所选 AI 提供商进行解释、总结、翻译和连续追问。

## 环境要求

- Node.js 20.19 或更高版本
- npm
- Chrome 116+ 或兼容的 Edge 版本

## 构建与安装

```bash
npm install
npm run build
```

1. 打开 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目构建生成的 `dist` 目录。
5. 点击扩展图标打开侧边栏，在设置页配置 AI 提供商、API Key 和模型。

源代码目录不能直接作为扩展加载。修改代码后重新执行 `npm run build`，或在开发期间运行 `npm run dev` 持续构建。

## 开发命令

```bash
npm run dev            # 监听源代码并持续生成 dist
npm run build          # 类型检查并生成生产构建
npm run typecheck      # TypeScript 严格检查
npm run lint           # ESLint 检查
npm test               # Vitest 单元与组件测试
npm run test:coverage  # 输出测试覆盖率
npm run check          # 完整质量检查与生产构建
```

主要源码位于：

- `src/sidepanel/`：React 侧边栏、会话 reducer、流式请求和页面捕获交互。
- `src/options/`：React 设置工作台、提供商草稿和模型发现流程。
- `src/background/`：Manifest V3 Service Worker。
- `src/content/`：按用户操作动态注入的可见 DOM 文字提取脚本。
- `src/shared/`：领域类型、存储迁移、提供商解析、Chrome API 适配器和 OpenAI 兼容客户端。
- `src/styles/`：共享语义颜色、明暗主题和全局基础样式。

## 使用

1. 打开侧边栏后可以直接输入问题开始对话。
2. 也可以在普通网页中选中一段文字，点击右键选择“用 SidebarAgent 分析所选内容”。
3. 在侧边栏中使用快捷操作，或继续输入自己的问题。
4. 也可以点击顶栏的读取按钮，将当前视口内的可见 DOM 文字作为新的对话来源。

## 侧边栏行为

- 顶栏、来源区和输入区保持稳定，中间消息区域承担主要滚动。
- 来源文字默认折叠，可显式展开；超长来源在限定高度内滚动。
- 发送按钮在生成期间切换为停止按钮。
- 当前提供商存在可信模型列表时，可直接在侧边栏切换模型。
- AI 回复使用安全的 React Markdown 渲染，支持 GFM 表格、列表、引用和代码块。
- 原始 HTML 不会作为扩展页面 DOM 执行，外链只允许 HTTP 和 HTTPS。
- 界面跟随系统明暗主题，并遵守 `prefers-reduced-motion`。

## 提供商与模型

- 内置 DeepSeek、千问国内站、千问国际站和火山方舟。
- 可以保存多个 OpenAI Chat Completions 兼容的自定义提供商。
- 自定义远程接口必须使用 HTTPS；`localhost` 和 `127.0.0.1` 可以使用 HTTP。
- 模型列表只在用户主动点击获取或刷新时请求。
- 不支持模型发现时可以切换为手动模型 ID。
- 自定义接口只在保存配置或发起请求时申请对应域名的最小访问权限。

## 数据与安全

- API Key、模型列表和提供商配置保存在 `chrome.storage.local`。
- 当前来源和对话保存在 `chrome.storage.session`，浏览器会话结束后清除；没有网页来源的直接对话同样会保存。
- 旧版 DeepSeek 配置会自动迁移到当前 settings v2 结构，旧存储键继续保留以便回退。
- 如果存在网页来源，选中文字、网页标题、网址、清洗后的视口内容和对话会发送给当前 AI 提供商；直接对话只发送对话内容。
- 扩展不使用远程脚本、分析服务、截图或 OCR，也不会后台自动读取网页。
- API Key 不会写入仓库文件或错误日志；浏览器扩展存储仍不等同于系统级加密保险箱。

## 当前限制

- 自定义服务需要兼容 OpenAI `/chat/completions` 流式 SSE 和 Bearer Token 鉴权。
- 单次选区或视口纯文本最多保留 12,000 个字符。
- 视口清洗 HTML 最多保留 24,000 个字符，并在完整标签边界内截取。
- 浏览器内部页面、扩展商店、图片、Canvas、视频和 PDF 内嵌画面不能通过 DOM 文字读取功能获取。
- 本项目不提供实时联网搜索能力。

## 参与贡献

提交改动前请阅读 [CONTRIBUTINGGUIDE.md](CONTRIBUTINGGUIDE.md)，并至少运行 `npm run check` 和 `git diff --check`。
