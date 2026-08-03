// Side-panel controller: renders trusted DOM nodes, owns the conversation state
// machine and coordinates storage, permissions and streaming provider requests.
import {
  MAX_CONTEXT_CHARS,
  DEFAULT_PROVIDER_ID,
  PENDING_SELECTION_KEY,
  QUICK_ACTIONS,
  REQUEST_TIMEOUT_MS,
  SETTINGS_KEY,
  SYSTEM_PROMPT
} from "./shared/constants.js";
import { ProviderError, streamChat } from "./shared/openai-compatible-client.js";
import { parseMarkdownTable } from "./shared/markdown-table.js";
import { resolveProvider } from "./shared/providers.js";
import {
  clearConversationSession,
  getConversationSession,
  getPendingSelection,
  getSettings,
  getEffectiveModel,
  isProviderConfigurationValid,
  normalizeSettings,
  saveConversationSession,
  saveSettings,
  selectAvailableModel
} from "./shared/storage.js";
import { getActionButtonState } from "./shared/ui-state.js";

const CONFIGURATION_ERROR = "请先配置 API Key 并选择一个可用模型。";

// Cache controls once; render functions update these nodes without querying again.
const elements = {
  clearButton: document.querySelector("#clearButton"),
  captureViewportButton: document.querySelector("#captureViewportButton"),
  settingsButton: document.querySelector("#settingsButton"),
  setupNotice: document.querySelector("#setupNotice"),
  setupNoticeText: document.querySelector("#setupNoticeText"),
  setupButton: document.querySelector("#setupButton"),
  sourceDock: document.querySelector("#sourceDock"),
  sourcePanel: document.querySelector("#sourcePanel"),
  sourceLabel: document.querySelector("#sourceLabel"),
  sourceMeta: document.querySelector("#sourceMeta"),
  sourceLink: document.querySelector("#sourceLink"),
  sourcePreviewRow: document.querySelector("#sourcePreviewRow"),
  sourceText: document.querySelector("#sourceText"),
  truncatedNotice: document.querySelector("#truncatedNotice"),
  toggleSourceButton: document.querySelector("#toggleSourceButton"),
  toggleSourceLabel: document.querySelector("#toggleSourceButton .toggle-label"),
  quickActions: document.querySelector("#quickActions"),
  content: document.querySelector("#content"),
  emptyState: document.querySelector("#emptyState"),
  emptyCaptureButton: document.querySelector("#emptyCaptureButton"),
  emptyCaptureText: document.querySelector("#emptyCaptureText"),
  messages: document.querySelector("#messages"),
  errorPanel: document.querySelector("#errorPanel"),
  errorText: document.querySelector("#errorText"),
  retryButton: document.querySelector("#retryButton"),
  questionInput: document.querySelector("#questionInput"),
  actionButton: document.querySelector("#actionButton"),
  modelSelect: document.querySelector("#modelSelect"),
  modelPickerButton: document.querySelector("#modelPickerButton"),
  modelPickerProvider: document.querySelector(".model-picker-provider"),
  modelPickerLabel: document.querySelector("#modelPickerLabel"),
  modelPickerMenu: document.querySelector("#modelPickerMenu"),
  statusText: document.querySelector("#statusText"),
  characterCount: document.querySelector("#characterCount")
};

// Ephemeral UI/request state lives here. Persistent settings and session data are
// loaded through shared/storage.js and normalized before entering this object.
const state = {
  source: null,
  messages: [],
  sourceExpanded: false,
  sourceOverflowing: false,
  sourceMeasureQueued: false,
  activeProviderId: DEFAULT_PROVIDER_ID,
  providerName: "DeepSeek",
  hasApiKey: false,
  selectedModel: "",
  availableModels: [],
  modelSelectionMode: "list",
  modelSwitching: false,
  capturingViewport: false,
  capturePermissionOrigin: "",
  requestProviderName: "",
  busy: false,
  submitting: false,
  error: "",
  status: "",
  controller: null,
  timeoutId: null,
  stopReason: "",
  renderQueued: false
};

function createId() {
  return crypto.randomUUID();
}

function isSafeWebUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function appendInline(parent, text) {
  // Build DOM nodes instead of using innerHTML because model output is untrusted.
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    const element = token.startsWith("`")
      ? document.createElement("code")
      : document.createElement("strong");
    element.textContent = token.startsWith("`") ? token.slice(1, -1) : token.slice(2, -2);
    parent.append(element);
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function isBlockStart(line) {
  return /^```|^#{1,3}\s|^[-*]\s|^\d+\.\s|^>\s?/.test(line);
}

function renderTable(container, tableData) {
  const scrollArea = document.createElement("div");
  scrollArea.className = "markdown-table-wrap";
  scrollArea.tabIndex = 0;
  scrollArea.setAttribute("aria-label", "表格");
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  tableData.headers.forEach((content, columnIndex) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.className = `align-${tableData.alignments[columnIndex]}`;
    appendInline(cell, content);
    headerRow.append(cell);
  });
  head.append(headerRow);
  table.append(head);

  if (tableData.rows.length) {
    const body = document.createElement("tbody");
    for (const row of tableData.rows) {
      const tableRow = document.createElement("tr");
      row.forEach((content, columnIndex) => {
        const cell = document.createElement("td");
        cell.className = `align-${tableData.alignments[columnIndex]}`;
        appendInline(cell, content);
        tableRow.append(cell);
      });
      body.append(tableRow);
    }
    table.append(body);
  }
  scrollArea.append(table);
  container.append(scrollArea);
}

function renderMarkdown(container, text) {
  // This intentionally supports a small Markdown subset with predictable output.
  container.replaceChildren();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language) code.dataset.language = language;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      container.append(pre);
      continue;
    }

    const tableData = parseMarkdownTable(lines, index);
    if (tableData) {
      renderTable(container, tableData);
      index = tableData.nextIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const heading = document.createElement(`h${Math.min(headingMatch[1].length + 1, 4)}`);
      appendInline(heading, headingMatch[2]);
      container.append(heading);
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const list = document.createElement("ul");
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendInline(item, lines[index].replace(/^[-*]\s+/, ""));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const list = document.createElement("ol");
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        const item = document.createElement("li");
        appendInline(item, lines[index].replace(/^\d+\.\s+/, ""));
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      appendInline(quote, quoteLines.join("\n"));
      container.append(quote);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index]) && !parseMarkdownTable(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join("\n"));
    container.append(paragraph);
  }
}

const MESSAGE_ACTION_ICONS = {
  copy: ["M8 8h11v11H8z", "M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1"],
  regenerate: ["M20 7v5h-5", "M19 12a7 7 0 1 1-2.1-5"]
};

function createMessageActionIcon(iconName) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of MESSAGE_ACTION_ICONS[iconName]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}

function makeActionButton(label, iconName, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(createMessageActionIcon(iconName));
  button.addEventListener("click", onClick);
  return button;
}

function renderMessages() {
  elements.messages.replaceChildren();

  state.messages.forEach((message, index) => {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;

    const heading = document.createElement("div");
    heading.className = "message-heading";
    const role = document.createElement("span");
    role.className = "message-role";
    role.textContent = message.role === "user" ? "你" : message.providerName || "AI";
    heading.append(role);

    if (message.content) {
      const actions = document.createElement("div");
      actions.className = "message-actions";
      actions.append(makeActionButton("复制", "copy", async (event) => {
        const button = event.currentTarget;
        await navigator.clipboard.writeText(message.content);
        button.classList.add("is-success");
        button.title = "已复制";
        button.setAttribute("aria-label", "已复制");
        setTimeout(() => {
          button.classList.remove("is-success");
          button.title = "复制";
          button.setAttribute("aria-label", "复制");
        }, 1200);
      }));

      const isLatestAssistant = message.role === "assistant" && index === state.messages.length - 1;
      if (isLatestAssistant && !state.busy) {
        actions.append(makeActionButton("重新生成", "regenerate", () => regenerateLastReply()));
      }
      heading.append(actions);
    }

    const body = document.createElement("div");
    body.className = "message-body";
    if (message.content) renderMarkdown(body, message.content);
    if (state.busy && index === state.messages.length - 1 && message.role === "assistant") {
      const cursor = document.createElement("span");
      cursor.className = "streaming-cursor";
      cursor.setAttribute("aria-label", "正在生成");
      body.append(cursor);
    }

    article.append(heading, body);
    elements.messages.append(article);
  });

  if (state.messages.length) {
    // Scroll after layout so streamed content remains visible without moving fixed UI.
    requestAnimationFrame(() => {
      elements.content.scrollTop = elements.content.scrollHeight;
    });
  }
}

function scheduleMessageRender() {
  // Coalesce rapid SSE deltas into at most one DOM rebuild per animation frame.
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderMessages();
  });
}

function renderSource() {
  const hasSource = Boolean(state.source);
  elements.sourceDock.hidden = !hasSource;
  elements.quickActions.hidden = !hasSource;
  elements.emptyState.hidden = hasSource || state.messages.length > 0;
  if (!hasSource) return;

  const sourceLabel = state.source.captureType === "viewport" ? "页面文字" : "选中文本";
  const originalLength = Number.isFinite(state.source.originalLength)
    ? state.source.originalLength
    : state.source.text.length;
  elements.sourceLabel.textContent = sourceLabel;
  elements.sourceMeta.textContent = state.source.truncated
    ? `${state.source.text.length.toLocaleString()} / ${originalLength.toLocaleString()} 字`
    : `${originalLength.toLocaleString()} 字`;
  elements.sourcePanel.setAttribute("aria-label", `${sourceLabel}，来自${state.source.title}`);
  elements.sourceLink.textContent = state.source.title;
  if (isSafeWebUrl(state.source.url)) {
    elements.sourceLink.href = state.source.url;
    elements.sourceLink.title = state.source.url;
  } else {
    elements.sourceLink.removeAttribute("href");
    elements.sourceLink.removeAttribute("title");
  }
  elements.sourceText.textContent = state.source.text;
  elements.sourceDock.classList.toggle("is-expanded", state.sourceExpanded);
  elements.toggleSourceButton.hidden = !state.sourceExpanded && !state.sourceOverflowing;
  elements.toggleSourceLabel.textContent = state.sourceExpanded ? "收起" : "展开";
  elements.toggleSourceButton.setAttribute("aria-expanded", String(state.sourceExpanded));
  elements.toggleSourceButton.title = state.sourceExpanded ? "收起来源文字" : "展开来源文字";
  elements.toggleSourceButton.setAttribute("aria-label", elements.toggleSourceButton.title);
  elements.truncatedNotice.hidden = !state.source.truncated;
  elements.truncatedNotice.textContent = state.source.truncated
    ? `原文共 ${state.source.originalLength.toLocaleString()} 个字符，已保留前 12,000 个字符。`
    : "";
  scheduleSourceOverflowMeasure();
}

function scheduleSourceOverflowMeasure() {
  // Measure after paint; clamp-based overflow is not reliable before layout settles.
  if (!state.source || state.sourceExpanded || state.sourceMeasureQueued) return;
  state.sourceMeasureQueued = true;
  requestAnimationFrame(() => {
    state.sourceMeasureQueued = false;
    if (!state.source || state.sourceExpanded) return;
    const overflowing = elements.sourceText.scrollWidth > elements.sourcePreviewRow.clientWidth + 1 ||
      elements.sourceText.scrollHeight > elements.sourceText.clientHeight + 1;
    if (overflowing === state.sourceOverflowing) return;
    state.sourceOverflowing = overflowing;
    elements.toggleSourceButton.hidden = !overflowing;
  });
}

function renderControls() {
  // A single render path keeps visible, disabled and accessibility states synchronized.
  const configured = Boolean(state.hasApiKey && state.selectedModel);
  const preparing = state.submitting && !state.busy;
  const actionState = getActionButtonState({
    busy: state.busy,
    submitting: state.submitting,
    hasSource: Boolean(state.source),
    hasText: Boolean(elements.questionInput.value.trim())
  });
  elements.setupNotice.hidden = configured;
  elements.setupNoticeText.textContent = state.hasApiKey
    ? `尚未选择可用的${state.providerName}模型`
    : "尚未配置 AI 提供商";
  renderModelSelect();
  elements.questionInput.disabled = !state.source;
  elements.clearButton.disabled = state.submitting;
  elements.captureViewportButton.disabled = state.capturingViewport || state.submitting;
  elements.captureViewportButton.classList.toggle("is-capturing", state.capturingViewport);
  elements.captureViewportButton.title = state.capturingViewport ? "正在读取当前屏幕文字" : "读取当前屏幕文字";
  elements.captureViewportButton.setAttribute("aria-label", elements.captureViewportButton.title);
  elements.captureViewportButton.setAttribute("aria-busy", String(state.capturingViewport));
  elements.emptyCaptureButton.disabled = state.capturingViewport || state.submitting;
  elements.emptyCaptureButton.classList.toggle("is-capturing", state.capturingViewport);
  elements.emptyCaptureText.textContent = state.capturingViewport ? "正在读取" : "读取当前页面";
  elements.emptyCaptureButton.setAttribute("aria-busy", String(state.capturingViewport));
  elements.actionButton.disabled = actionState.disabled;
  elements.actionButton.classList.toggle("is-generating", actionState.generating);
  elements.actionButton.title = actionState.label;
  elements.actionButton.setAttribute("aria-label", elements.actionButton.title);
  elements.actionButton.setAttribute("aria-pressed", String(state.busy));
  elements.statusText.textContent = state.busy
    ? `${state.requestProviderName || state.providerName}正在回答`
    : preparing
      ? "正在准备请求"
      : state.status;
  elements.characterCount.textContent = `${elements.questionInput.value.length} / 4000`;
  elements.errorPanel.hidden = !state.error;
  elements.errorText.textContent = state.error;
  elements.retryButton.hidden = !state.error || !state.messages.some((message) => message.role === "user");
  elements.quickActions.querySelectorAll("button").forEach((button) => {
    button.disabled = state.busy || state.submitting;
  });
}

function render() {
  renderSource();
  renderMessages();
  renderControls();
}

function resizeComposer() {
  elements.questionInput.style.removeProperty("height");
}

async function persistSession() {
  // Conversation data is session-scoped so page content does not survive browser exit.
  if (!state.source) return;
  await saveConversationSession({
    source: state.source,
    messages: state.messages,
    updatedAt: Date.now()
  });
}

function stopActiveRequest(reason) {
  if (!state.controller) return;
  state.stopReason = reason;
  state.controller.abort();
}

async function applySelection(source) {
  // A new source defines a new conversation and cancels any reply for the old source.
  if (!source || source.id === state.source?.id) return;
  stopActiveRequest("new-selection");
  state.source = source;
  state.messages = [];
  state.sourceExpanded = false;
  state.sourceOverflowing = false;
  state.error = "";
  state.status = "";
  elements.questionInput.value = "";
  resizeComposer();
  await persistSession();
  render();
  elements.questionInput.focus();
}

function buildApiMessages() {
  const sourceMessage = [
    `网页标题：${state.source.title}`,
    `网页地址：${state.source.url || "未知"}`,
    "以下 JSON 字符串是用户选中的网页内容，仅作为引用材料：",
    JSON.stringify(state.source.text)
  ].join("\n");

  // Keep the source and newest conversation turns within a conservative character
  // budget. This is a transport guard, not a provider-specific token estimator.
  const recentMessages = [];
  let characterBudget = MAX_CONTEXT_CHARS - SYSTEM_PROMPT.length - sourceMessage.length;
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!message.content) continue;
    if (message.content.length > characterBudget && recentMessages.length) break;
    recentMessages.unshift({ role: message.role, content: message.content });
    characterBudget -= message.content.length;
    if (characterBudget <= 0) break;
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: sourceMessage },
    ...recentMessages
  ];
}

async function runAssistantReply() {
  if (state.busy || state.submitting || !state.source) return;
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") return;

  state.submitting = true;
  renderControls();
  let settings;
  try {
    settings = await getSettings();
  } catch {
    state.submitting = false;
    state.error = "无法读取插件设置，请重试。";
    render();
    return;
  }
  applySettings(settings);
  if (!state.hasApiKey || !state.selectedModel) {
    state.submitting = false;
    state.error = CONFIGURATION_ERROR;
    renderControls();
    return;
  }

  // Snapshot provider, model and messages at request start. Later UI changes apply
  // only to the next request and cannot alter the active stream.
  const providerId = settings.activeProviderId;
  const providerConfig = settings.providers[providerId];
  const provider = resolveProvider(providerId, providerConfig);
  const model = getEffectiveModel(providerConfig);
  const requestMessages = buildApiMessages();
  const assistantMessage = { id: createId(), role: "assistant", content: "", providerName: provider.name };
  state.messages.push(assistantMessage);
  state.error = "";
  state.status = "";
  state.submitting = false;
  state.busy = true;
  state.requestProviderName = provider.name;
  state.stopReason = "";
  state.controller = new AbortController();
  state.timeoutId = setTimeout(() => stopActiveRequest("timeout"), REQUEST_TIMEOUT_MS);
  render();

  try {
    await streamChat({
      provider,
      apiKey: providerConfig.apiKey,
      model,
      messages: requestMessages,
      signal: state.controller.signal,
      onDelta(delta) {
        assistantMessage.content += delta;
        scheduleMessageRender();
      }
    });
    if (!assistantMessage.content) {
      throw new ProviderError(`${provider.name}没有返回可显示的内容。`, { code: "empty" });
    }
  } catch (error) {
    if (error.name === "AbortError") {
      if (state.stopReason === "timeout") state.error = "请求超过 120 秒，已自动停止。";
      else if (state.stopReason === "user") state.status = "已停止生成";
    } else {
      state.error = error instanceof ProviderError ? error.message : "请求失败，请稍后重试。";
    }

    if (!assistantMessage.content) {
      state.messages = state.messages.filter((message) => message.id !== assistantMessage.id);
    }
  } finally {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
    state.controller = null;
    state.busy = false;
    state.requestProviderName = "";
    await persistSession();
    render();
  }
}

async function submitQuestion(question) {
  const content = question.trim();
  if (!content || state.busy || state.submitting || !state.source) return;
  state.submitting = true;
  renderControls();
  state.messages.push({ id: createId(), role: "user", content });
  state.error = "";
  state.status = "";
  elements.questionInput.value = "";
  resizeComposer();
  try {
    // Save the user turn before network I/O so a failed request remains retryable.
    await persistSession();
  } catch {
    state.error = "无法保存当前问题，请重试。";
    state.submitting = false;
    render();
    return;
  }
  state.submitting = false;
  await runAssistantReply();
}

function retryLastReply() {
  if (state.busy || state.submitting) return;
  if (state.messages.at(-1)?.role === "assistant") state.messages.pop();
  state.error = "";
  runAssistantReply();
}

function regenerateLastReply() {
  if (state.busy || state.submitting || state.messages.at(-1)?.role !== "assistant") return;
  state.messages.pop();
  state.error = "";
  runAssistantReply();
}

async function clearCurrentSession() {
  stopActiveRequest("clear");
  await clearConversationSession();
  state.source = null;
  state.messages = [];
  state.sourceExpanded = false;
  state.sourceOverflowing = false;
  state.error = "";
  state.status = "";
  elements.questionInput.value = "";
  resizeComposer();
  render();
}

async function captureViewportText() {
  if (state.capturingViewport || state.submitting) return;
  state.capturingViewport = true;
  state.error = "";
  state.status = "正在读取当前屏幕文字";
  renderControls();
  try {
    let origin = state.capturePermissionOrigin;
    if (!origin) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) throw new Error("无法确定当前网页地址。");
      const url = new URL(tab.url);
      if (!["http:", "https:", "file:"].includes(url.protocol)) {
        throw new Error("当前浏览器页面不允许读取文字，请切换到普通网页。");
      }
      origin = url.protocol === "file:" ? "" : `${url.protocol}//${url.hostname}/*`;
      state.capturePermissionOrigin = origin;
    }
    if (origin) {
      // Site access is requested only from this click flow to preserve user gesture.
      let granted;
      try {
        granted = await chrome.permissions.request({ origins: [origin] });
      } catch (error) {
        if (/user gesture/i.test(error.message || "")) {
          throw new Error("需要网页访问授权，请再次点击读取按钮。");
        }
        throw error;
      }
      if (!granted) throw new Error("未获得当前网站的文字读取权限。");
    }
    state.capturePermissionOrigin = "";
    const response = await chrome.runtime.sendMessage({ type: "capture-visible-text" });
    if (!response?.ok) throw new Error(response?.error || "读取当前屏幕文字失败。");
    await applySelection(response.source);
    state.status = response.source.truncated
      ? "已读取当前屏幕文字，内容已按长度上限截取"
      : "已读取当前屏幕文字";
  } catch (error) {
    state.error = error.message || "读取当前屏幕文字失败。";
    state.status = "";
  } finally {
    state.capturingViewport = false;
    render();
  }
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function renderModelSelect() {
  // The hidden native select remains the canonical value and event source; the
  // custom picker provides the compact visual interface and keyboard behavior.
  const select = elements.modelSelect;
  const isListMode = state.modelSelectionMode === "list";
  const currentModelIsAvailable = state.availableModels.includes(state.selectedModel);
  const canSelect = state.hasApiKey && isListMode && currentModelIsAvailable &&
    !state.modelSwitching && !state.submitting;
  const displayText = !state.hasApiKey
    ? "未配置 AI 提供商"
    : state.selectedModel
      ? `${state.providerName} · ${state.selectedModel}`
      : `${state.providerName} · 未配置模型`;

  select.replaceChildren();
  if (canSelect) {
    const group = document.createElement("optgroup");
    group.label = state.providerName;
    for (const model of state.availableModels) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      group.append(option);
    }
    select.append(group);
    select.value = state.selectedModel;
  } else {
    const option = document.createElement("option");
    option.value = state.selectedModel;
    option.textContent = displayText;
    select.append(option);
  }
  select.disabled = !canSelect;
  select.setAttribute("aria-label", `选择${state.providerName}模型`);
  select.title = canSelect
    ? `${state.providerName}：${state.selectedModel}；选择下次请求使用的模型`
    : isListMode ? displayText : `${displayText}；手动模型请在设置页修改`;
  renderModelPicker({ canSelect, displayText });
}

function renderModelPicker({ canSelect, displayText }) {
  const button = elements.modelPickerButton;
  const menu = elements.modelPickerMenu;
  const wasOpen = button.getAttribute("aria-expanded") === "true";
  elements.modelPickerProvider.textContent = state.hasApiKey ? state.providerName : "AI";
  elements.modelPickerLabel.textContent = state.selectedModel || displayText.replace(`${state.providerName} · `, "");
  button.disabled = !canSelect;
  button.title = canSelect
    ? `${state.providerName}：${state.selectedModel}；打开模型列表`
    : displayText;
  button.setAttribute("aria-label", canSelect ? `选择${state.providerName}模型，当前为${state.selectedModel}` : displayText);
  if (!canSelect) setModelPickerOpen(false);
  menu.replaceChildren();
  menu.hidden = !canSelect || !wasOpen;
  if (!canSelect) return;
  for (const model of state.availableModels) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "model-picker-option";
    option.dataset.model = model;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(model === state.selectedModel));
    const name = document.createElement("span");
    name.className = "model-picker-option-name";
    name.textContent = model;
    option.append(name);
    if (model === state.selectedModel) {
      const check = document.createElement("span");
      check.className = "model-picker-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      option.append(check);
    }
    menu.append(option);
  }
}

function setModelPickerOpen(open) {
  const shouldOpen = Boolean(open && !elements.modelPickerButton.disabled);
  elements.modelPickerMenu.hidden = !shouldOpen;
  elements.modelPickerButton.setAttribute("aria-expanded", String(shouldOpen));
  elements.modelPickerButton.classList.toggle("is-open", shouldOpen);
}

function selectModelFromPicker(model) {
  if (!model || elements.modelSelect.disabled) return;
  elements.modelSelect.value = model;
  setModelPickerOpen(false);
  elements.modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
}

async function changeSelectedModel(model) {
  const providerId = state.activeProviderId;
  const previousModel = state.selectedModel;
  if (!model || model === previousModel || state.modelSwitching) return;
  state.modelSwitching = true;
  state.error = "";
  state.status = "";
  let restorePreviousModel = true;
  renderControls();
  try {
    // Re-read storage to avoid overwriting provider changes made in the options tab.
    const latestSettings = await getSettings();
    if (latestSettings.activeProviderId !== providerId) {
      applySettings(latestSettings);
      restorePreviousModel = false;
      throw new Error("当前提供商已变化，请重新选择模型。");
    }
    const updatedSettings = selectAvailableModel(latestSettings, providerId, model);
    await saveSettings(updatedSettings);
    applySettings(updatedSettings);
    state.status = `已切换模型：${model}`;
  } catch (error) {
    state.status = `切换模型失败：${error.message || "请重试。"}`;
    if (restorePreviousModel) state.selectedModel = previousModel;
  } finally {
    state.modelSwitching = false;
    renderControls();
  }
}

function applySettings(settings) {
  const providerId = settings.activeProviderId;
  const providerConfig = settings.providers[providerId];
  const provider = resolveProvider(providerId, providerConfig);
  state.activeProviderId = providerId;
  state.providerName = provider?.name || "AI";
  state.hasApiKey = Boolean(providerConfig?.apiKey);
  state.availableModels = providerConfig?.modelSelectionMode === "list"
    ? providerConfig.availableModels
    : [];
  state.modelSelectionMode = providerConfig?.modelSelectionMode || "list";
  state.selectedModel = provider && isProviderConfigurationValid(providerConfig, providerId)
    ? getEffectiveModel(providerConfig)
    : "";
}

// User interaction and cross-context storage events enter the state machine here.
elements.settingsButton.addEventListener("click", openSettings);
elements.setupButton.addEventListener("click", openSettings);
elements.captureViewportButton.addEventListener("click", captureViewportText);
elements.emptyCaptureButton.addEventListener("click", captureViewportText);
elements.clearButton.addEventListener("click", clearCurrentSession);
elements.toggleSourceButton.addEventListener("click", () => {
  state.sourceExpanded = !state.sourceExpanded;
  renderSource();
});
elements.actionButton.addEventListener("click", () => {
  if (state.busy) stopActiveRequest("user");
  else submitQuestion(elements.questionInput.value);
});
elements.modelPickerButton.addEventListener("click", () => {
  setModelPickerOpen(elements.modelPickerMenu.hidden);
});
elements.modelPickerButton.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    setModelPickerOpen(true);
    elements.modelPickerMenu.querySelector(".model-picker-option")?.focus();
  }
  if (event.key === "Escape") setModelPickerOpen(false);
});
elements.modelPickerMenu.addEventListener("click", (event) => {
  const option = event.target.closest(".model-picker-option");
  if (option) selectModelFromPicker(option.dataset.model);
});
elements.modelPickerMenu.addEventListener("keydown", (event) => {
  const options = [...elements.modelPickerMenu.querySelectorAll(".model-picker-option")];
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const nextIndex = event.key === "ArrowDown"
      ? (currentIndex + 1) % options.length
      : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectModelFromPicker(document.activeElement?.dataset.model);
  } else if (event.key === "Escape") {
    setModelPickerOpen(false);
    elements.modelPickerButton.focus();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!elements.modelPickerMenu.hidden && !elements.modelPickerMenu.contains(event.target) && !elements.modelPickerButton.contains(event.target)) {
    setModelPickerOpen(false);
  }
});
elements.modelSelect.addEventListener("change", () => changeSelectedModel(elements.modelSelect.value));
elements.retryButton.addEventListener("click", retryLastReply);
elements.questionInput.addEventListener("input", () => {
  resizeComposer();
  renderControls();
});
elements.questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitQuestion(elements.questionInput.value);
  }
});
elements.quickActions.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  submitQuestion(QUICK_ACTIONS[button.dataset.action]);
});
window.addEventListener("resize", scheduleSourceOverflowMeasure);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && changes[PENDING_SELECTION_KEY]?.newValue) {
    applySelection(changes[PENDING_SELECTION_KEY].newValue);
  }
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    const settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    applySettings(settings);
    if (state.selectedModel && state.error === CONFIGURATION_ERROR) state.error = "";
    renderControls();
  }
});

async function initialize() {
  // Load independent storage areas concurrently, then let a newer pending selection
  // override the restored conversation source.
  const [settings, session, pendingSelection] = await Promise.all([
    getSettings(),
    getConversationSession(),
    getPendingSelection()
  ]);

  applySettings(settings);
  if (session?.source) {
    state.source = session.source;
    state.messages = Array.isArray(session.messages) ? session.messages : [];
  }
  if (pendingSelection && pendingSelection.id !== state.source?.id) {
    state.source = pendingSelection;
    state.messages = [];
    await persistSession();
  }
  render();
}

initialize().catch((error) => {
  state.error = `插件初始化失败：${error.message}`;
  render();
});
