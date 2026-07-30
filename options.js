import { DEFAULT_MODEL, MODEL_FETCH_TIMEOUT_MS } from "./shared/constants.js";
import { fetchModels } from "./shared/deepseek-client.js";
import {
  clearSettings,
  getSettings,
  isConfigurationValid,
  normalizeSettings,
  saveSettings
} from "./shared/storage.js";

const apiKeyInput = document.querySelector("#apiKey");
const settingsForm = document.querySelector("#settingsForm");
const modelSelect = document.querySelector("#modelSelect");
const modelMeta = document.querySelector("#modelMeta");
const saveButton = document.querySelector("#saveButton");
const fetchModelsButton = document.querySelector("#fetchModelsButton");
const clearKeyButton = document.querySelector("#clearKeyButton");
const toggleVisibility = document.querySelector("#toggleVisibility");
const statusMessage = document.querySelector("#statusMessage");

let savedSettings = normalizeSettings(null);
let workingModels = [];
let modelsFetchedAt = null;
let fetchedForKey = "";
let fetchController = null;
let fetchStopReason = "";

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function currentApiKey() {
  return apiKeyInput.value.trim();
}

function hasCurrentModelList() {
  return Boolean(
    currentApiKey() &&
    currentApiKey() === fetchedForKey &&
    workingModels.length
  );
}

function currentDraft() {
  return normalizeSettings({
    apiKey: currentApiKey(),
    selectedModel: modelSelect.value,
    availableModels: workingModels,
    modelsFetchedAt
  });
}

function formatFetchedAt(timestamp) {
  if (!timestamp) return "兼容旧版配置，建议刷新模型列表";
  return `已获取 ${workingModels.length} 个模型 · ${new Date(timestamp).toLocaleString("zh-CN")}`;
}

function populateModelSelect(models, selectedModel = "", missingModel = "") {
  modelSelect.replaceChildren();

  if (missingModel) {
    const unavailable = document.createElement("option");
    unavailable.value = "";
    unavailable.textContent = `${missingModel} 已不可用，请重新选择`;
    modelSelect.append(unavailable);
  } else if (!selectedModel) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择模型";
    modelSelect.append(placeholder);
  }

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.append(option);
  });
  modelSelect.value = selectedModel && models.includes(selectedModel) ? selectedModel : "";
}

function renderState() {
  const busy = Boolean(fetchController);
  const apiKey = currentApiKey();
  const listIsCurrent = hasCurrentModelList();
  const validDraft = listIsCurrent && isConfigurationValid(currentDraft());

  apiKeyInput.disabled = busy;
  toggleVisibility.disabled = busy;
  modelSelect.disabled = busy || !listIsCurrent;
  saveButton.disabled = busy || !validDraft;
  clearKeyButton.disabled = busy || (!apiKey && !savedSettings.apiKey);
  fetchModelsButton.disabled = !busy && !apiKey;
  fetchModelsButton.textContent = busy
    ? "取消获取"
    : apiKey && apiKey === savedSettings.apiKey && workingModels.length
      ? "刷新模型列表"
      : "连接并获取模型";

  if (!apiKey) modelMeta.textContent = "";
  else if (!listIsCurrent) modelMeta.textContent = "API Key 已更改，请重新获取模型列表";
  else modelMeta.textContent = formatFetchedAt(modelsFetchedAt);
}

async function handleSave(event) {
  event.preventDefault();
  const settings = currentDraft();
  if (!hasCurrentModelList() || !isConfigurationValid(settings)) {
    setStatus("请先获取模型列表并选择一个可用模型。", true);
    return;
  }

  await saveSettings(settings);
  savedSettings = settings;
  setStatus(`配置已保存，当前模型：${settings.selectedModel}`);
  renderState();
}

async function handleFetchModels() {
  if (fetchController) {
    fetchStopReason = "user";
    fetchController.abort();
    return;
  }

  const apiKey = currentApiKey();
  if (!apiKey) {
    setStatus("请输入 DeepSeek API Key。", true);
    apiKeyInput.focus();
    return;
  }

  fetchController = new AbortController();
  fetchStopReason = "";
  const previouslyFetchedKey = fetchedForKey;
  const previouslySelectedModel = modelSelect.value;
  setStatus("正在获取可用模型…");
  renderState();
  const timeoutId = setTimeout(() => {
    fetchStopReason = "timeout";
    fetchController?.abort();
  }, MODEL_FETCH_TIMEOUT_MS);

  try {
    const models = await fetchModels(apiKey, fetchController.signal);
    const isSavedKey = Boolean(savedSettings.apiKey && apiKey === savedSettings.apiKey);
    const isRefreshedDraftKey = Boolean(previouslyFetchedKey && apiKey === previouslyFetchedKey);
    const previousModel = isSavedKey
      ? savedSettings.selectedModel
      : isRefreshedDraftKey
        ? previouslySelectedModel
        : "";
    const previousModelMissing = Boolean(previousModel && !models.includes(previousModel));
    const selectedModel = previousModelMissing
      ? ""
      : models.includes(previousModel)
        ? previousModel
        : !isSavedKey && !isRefreshedDraftKey && models.includes(DEFAULT_MODEL)
          ? DEFAULT_MODEL
          : "";

    workingModels = models;
    modelsFetchedAt = Date.now();
    fetchedForKey = apiKey;
    populateModelSelect(models, selectedModel, previousModelMissing ? previousModel : "");

    if (isSavedKey) {
      savedSettings = normalizeSettings({
        apiKey,
        selectedModel,
        availableModels: models,
        modelsFetchedAt
      });
      await saveSettings(savedSettings);
    }

    if (previousModelMissing) {
      setStatus(`原模型 ${previousModel} 已不可用，请重新选择并保存。`, true);
    } else {
      setStatus(`已获取 ${models.length} 个可用模型。`);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus(fetchStopReason === "timeout" ? "获取模型列表超时。" : "已取消获取模型列表。", fetchStopReason === "timeout");
    } else {
      setStatus(error.message || "获取模型列表失败。", true);
    }
  } finally {
    clearTimeout(timeoutId);
    fetchController = null;
    fetchStopReason = "";
    renderState();
  }
}

async function handleClear() {
  await clearSettings();
  savedSettings = normalizeSettings(null);
  workingModels = [];
  modelsFetchedAt = null;
  fetchedForKey = "";
  apiKeyInput.value = "";
  apiKeyInput.type = "password";
  toggleVisibility.title = "显示 API Key";
  toggleVisibility.setAttribute("aria-label", "显示 API Key");
  populateModelSelect([]);
  setStatus("API Key 和模型配置已清除。");
  renderState();
}

toggleVisibility.addEventListener("click", () => {
  const shouldShow = apiKeyInput.type === "password";
  apiKeyInput.type = shouldShow ? "text" : "password";
  toggleVisibility.title = shouldShow ? "隐藏 API Key" : "显示 API Key";
  toggleVisibility.setAttribute("aria-label", toggleVisibility.title);
});
apiKeyInput.addEventListener("input", () => {
  setStatus("");
  renderState();
});
modelSelect.addEventListener("change", () => {
  setStatus("");
  renderState();
});
settingsForm.addEventListener("submit", handleSave);
fetchModelsButton.addEventListener("click", handleFetchModels);
clearKeyButton.addEventListener("click", handleClear);

getSettings().then((settings) => {
  savedSettings = settings;
  workingModels = settings.availableModels;
  modelsFetchedAt = settings.modelsFetchedAt;
  fetchedForKey = settings.availableModels.length ? settings.apiKey : "";
  apiKeyInput.value = settings.apiKey;
  populateModelSelect(workingModels, settings.selectedModel);
  renderState();
}).catch((error) => {
  setStatus(`读取设置失败：${error.message}`, true);
});
