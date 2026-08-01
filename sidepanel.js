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

const elements = {
  clearButton: document.querySelector("#clearButton"),
  settingsButton: document.querySelector("#settingsButton"),
  setupNotice: document.querySelector("#setupNotice"),
  setupNoticeText: document.querySelector("#setupNoticeText"),
  setupButton: document.querySelector("#setupButton"),
  sourceDock: document.querySelector("#sourceDock"),
  sourcePanel: document.querySelector("#sourcePanel"),
  sourceLink: document.querySelector("#sourceLink"),
  sourceText: document.querySelector("#sourceText"),
  truncatedNotice: document.querySelector("#truncatedNotice"),
  toggleSourceButton: document.querySelector("#toggleSourceButton"),
  quickActions: document.querySelector("#quickActions"),
  content: document.querySelector("#content"),
  emptyState: document.querySelector("#emptyState"),
  messages: document.querySelector("#messages"),
  errorPanel: document.querySelector("#errorPanel"),
  errorText: document.querySelector("#errorText"),
  retryButton: document.querySelector("#retryButton"),
  questionInput: document.querySelector("#questionInput"),
  actionButton: document.querySelector("#actionButton"),
  modelSelect: document.querySelector("#modelSelect"),
  statusText: document.querySelector("#statusText"),
  characterCount: document.querySelector("#characterCount")
};

const state = {
  source: null,
  messages: [],
  sourcePinned: false,
  activeProviderId: DEFAULT_PROVIDER_ID,
  providerName: "DeepSeek",
  hasApiKey: false,
  selectedModel: "",
  availableModels: [],
  modelSelectionMode: "list",
  modelSwitching: false,
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

function renderMarkdown(container, text) {
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
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join("\n"));
    container.append(paragraph);
  }
}

function makeActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
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
      actions.append(makeActionButton("复制", async (event) => {
        await navigator.clipboard.writeText(message.content);
        event.currentTarget.textContent = "已复制";
        setTimeout(() => { event.currentTarget.textContent = "复制"; }, 1200);
      }));

      const isLatestAssistant = message.role === "assistant" && index === state.messages.length - 1;
      if (isLatestAssistant && !state.busy) {
        actions.append(makeActionButton("重新生成", () => regenerateLastReply()));
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
    requestAnimationFrame(() => {
      elements.content.scrollTop = elements.content.scrollHeight;
    });
  }
}

function scheduleMessageRender() {
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

  elements.sourceLink.textContent = state.source.title;
  if (isSafeWebUrl(state.source.url)) {
    elements.sourceLink.href = state.source.url;
    elements.sourceLink.title = state.source.url;
  } else {
    elements.sourceLink.removeAttribute("href");
    elements.sourceLink.removeAttribute("title");
  }
  elements.sourceText.textContent = state.source.text;
  elements.sourceDock.classList.toggle("is-pinned", state.sourcePinned);
  elements.toggleSourceButton.setAttribute("aria-pressed", String(state.sourcePinned));
  elements.toggleSourceButton.title = state.sourcePinned ? "取消固定" : "固定展开";
  elements.toggleSourceButton.setAttribute("aria-label", elements.toggleSourceButton.title);
  elements.truncatedNotice.hidden = !state.source.truncated;
  elements.truncatedNotice.textContent = state.source.truncated
    ? `原文共 ${state.source.originalLength.toLocaleString()} 个字符，已保留前 12,000 个字符。`
    : "";
}

function renderControls() {
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
  if (!source || source.id === state.source?.id) return;
  stopActiveRequest("new-selection");
  state.source = source;
  state.messages = [];
  state.sourcePinned = false;
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
  state.sourcePinned = false;
  state.error = "";
  state.status = "";
  elements.questionInput.value = "";
  resizeComposer();
  render();
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function renderModelSelect() {
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

elements.settingsButton.addEventListener("click", openSettings);
elements.setupButton.addEventListener("click", openSettings);
elements.clearButton.addEventListener("click", clearCurrentSession);
elements.toggleSourceButton.addEventListener("click", () => {
  state.sourcePinned = !state.sourcePinned;
  renderSource();
});
elements.actionButton.addEventListener("click", () => {
  if (state.busy) stopActiveRequest("user");
  else submitQuestion(elements.questionInput.value);
});
elements.modelSelect.addEventListener("change", () => changeSelectedModel(elements.modelSelect.value));
elements.retryButton.addEventListener("click", retryLastReply);
elements.questionInput.addEventListener("input", () => {
  resizeComposer();
  renderControls();
});
elements.questionInput.addEventListener("focus", () => {
  if (!state.sourcePinned) return;
  state.sourcePinned = false;
  renderSource();
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
