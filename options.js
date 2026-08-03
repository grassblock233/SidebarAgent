// Settings-page controller. Edits stay in an in-memory draft until the user
// saves, so failed model discovery cannot overwrite a working provider config.
import { DEFAULT_PROVIDER_ID, MODEL_FETCH_TIMEOUT_MS } from "./shared/constants.js";
import { fetchModels } from "./shared/openai-compatible-client.js";
import {
  BUILTIN_PROVIDER_IDS,
  BUILTIN_PROVIDERS,
  getOriginPattern,
  isCustomProviderId,
  resolveProvider,
  validateCustomBaseUrl
} from "./shared/providers.js";
import {
  createEmptySettings,
  getSettings,
  isProviderConfigurationValid,
  normalizeProviderConfig,
  normalizeSettings,
  saveSettings
} from "./shared/storage.js";

// Keep DOM lookups centralized so rendering functions operate on stable controls.
const elements = {
  providerSelect: document.querySelector("#providerSelect"),
  activeProviderBadge: document.querySelector("#activeProviderBadge"),
  deleteCustomButton: document.querySelector("#deleteCustomButton"),
  providerEndpoint: document.querySelector("#providerEndpoint"),
  configurationHeading: document.querySelector("#configurationHeading"),
  settingsForm: document.querySelector("#settingsForm"),
  customFields: document.querySelector("#customFields"),
  customName: document.querySelector("#customName"),
  baseUrl: document.querySelector("#baseUrl"),
  modelsPath: document.querySelector("#modelsPath"),
  chatPath: document.querySelector("#chatPath"),
  supportsModelDiscovery: document.querySelector("#supportsModelDiscovery"),
  apiKey: document.querySelector("#apiKey"),
  toggleVisibility: document.querySelector("#toggleVisibility"),
  manualModelToggle: document.querySelector("#manualModelToggle"),
  modelSelect: document.querySelector("#modelSelect"),
  manualModelInput: document.querySelector("#manualModelInput"),
  modelMeta: document.querySelector("#modelMeta"),
  fetchModelsButton: document.querySelector("#fetchModelsButton"),
  saveButton: document.querySelector("#saveButton"),
  activateButton: document.querySelector("#activateButton"),
  clearProviderButton: document.querySelector("#clearProviderButton"),
  statusMessage: document.querySelector("#statusMessage")
};

// appSettings is the persisted snapshot; workingConfig is the current form draft.
let appSettings = createEmptySettings();
let currentProviderId = DEFAULT_PROVIDER_ID;
let workingConfig = normalizeProviderConfig(null, currentProviderId);
let validatedFingerprint = "";
let fetchController = null;
let fetchStopReason = "";
const ADD_CUSTOM_PROVIDER = "__add_custom__";

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("error", isError);
}

function providerFingerprint(config, provider) {
  // A cached model list is trusted only for the exact key and discovery endpoint.
  if (!provider) return "";
  return [config.apiKey, provider.baseUrl, provider.modelsPath].join("\n");
}

function getDraftConfig() {
  // Read and normalize the form as one object before validation or persistence.
  const isCustom = isCustomProviderId(currentProviderId);
  const supportsDiscovery = isCustom ? elements.supportsModelDiscovery.checked : true;
  return normalizeProviderConfig({
    ...workingConfig,
    apiKey: elements.apiKey.value,
    modelSelectionMode: supportsDiscovery && !elements.manualModelToggle.checked ? "list" : "manual",
    selectedModel: elements.modelSelect.value,
    manualModel: elements.manualModelInput.value,
    name: isCustom ? elements.customName.value : undefined,
    baseUrl: isCustom ? elements.baseUrl.value : undefined,
    modelsPath: isCustom ? elements.modelsPath.value : undefined,
    chatPath: isCustom ? elements.chatPath.value : undefined,
    supportsModelDiscovery: supportsDiscovery
  }, currentProviderId);
}

function currentProvider(config = getDraftConfig()) {
  return resolveProvider(currentProviderId, config);
}

function populateProviderSelect() {
  elements.providerSelect.replaceChildren();
  const builtins = document.createElement("optgroup");
  builtins.label = "内置提供商";
  for (const providerId of BUILTIN_PROVIDER_IDS) {
    const option = document.createElement("option");
    option.value = providerId;
    option.textContent = BUILTIN_PROVIDERS[providerId].name;
    builtins.append(option);
  }
  elements.providerSelect.append(builtins);

  const customIds = Object.keys(appSettings.providers).filter(isCustomProviderId);
  if (customIds.length) {
    const customs = document.createElement("optgroup");
    customs.label = "自定义提供商";
    for (const providerId of customIds) {
      const option = document.createElement("option");
      option.value = providerId;
      option.textContent = appSettings.providers[providerId].name || "未命名提供商";
      customs.append(option);
    }
    elements.providerSelect.append(customs);
  }
  const actions = document.createElement("optgroup");
  actions.label = "操作";
  const addOption = document.createElement("option");
  addOption.value = ADD_CUSTOM_PROVIDER;
  addOption.textContent = "添加自定义提供商…";
  actions.append(addOption);
  elements.providerSelect.append(actions);
  elements.providerSelect.value = currentProviderId;
}

function populateModels(models, selectedModel = "") {
  elements.modelSelect.replaceChildren();
  if (!selectedModel) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = models.length ? "请选择模型" : "请先获取模型列表";
    elements.modelSelect.append(placeholder);
  }
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    elements.modelSelect.append(option);
  }
  elements.modelSelect.value = models.includes(selectedModel) ? selectedModel : "";
}

function formatFetchedAt(timestamp, count) {
  if (!timestamp) return count ? `已缓存 ${count} 个模型` : "";
  return `已获取 ${count} 个模型 · ${new Date(timestamp).toLocaleString("zh-CN")}`;
}

function isListTrusted(config, provider) {
  return Boolean(config.availableModels.length && providerFingerprint(config, provider) === validatedFingerprint);
}

function renderState() {
  // Derive all enabled, hidden and status states from the current draft.
  const busy = Boolean(fetchController);
  const config = getDraftConfig();
  const provider = currentProvider(config);
  const isCustom = isCustomProviderId(currentProviderId);
  const supportsDiscovery = provider?.supportsModelDiscovery !== false;
  const manualMode = config.modelSelectionMode === "manual";
  const listTrusted = isListTrusted(config, provider);
  const valid = isProviderConfigurationValid(config, currentProviderId) && (manualMode || listTrusted);

  elements.customFields.hidden = !isCustom;
  elements.deleteCustomButton.hidden = !isCustom;
  elements.configurationHeading.textContent = isCustom ? "连接配置" : "API 配置";
  elements.activeProviderBadge.hidden = appSettings.activeProviderId !== currentProviderId;
  elements.providerEndpoint.hidden = !isCustom;
  elements.providerEndpoint.textContent = provider
    ? `${provider.baseUrl}${provider.chatPath}`
    : isCustom ? "请填写有效的 Base URL" : "";

  elements.apiKey.disabled = busy;
  elements.toggleVisibility.disabled = busy;
  elements.providerSelect.disabled = busy;
  elements.deleteCustomButton.disabled = busy;
  elements.manualModelToggle.checked = manualMode;
  elements.manualModelToggle.disabled = busy || !supportsDiscovery;
  elements.modelSelect.hidden = manualMode;
  elements.modelSelect.disabled = busy || !listTrusted;
  elements.manualModelInput.hidden = !manualMode;
  elements.manualModelInput.disabled = busy;
  elements.fetchModelsButton.hidden = !supportsDiscovery;
  elements.fetchModelsButton.disabled = !busy && (!provider || !config.apiKey);
  elements.fetchModelsButton.textContent = busy ? "取消获取" : config.availableModels.length ? "刷新模型列表" : "连接并获取模型";
  elements.saveButton.disabled = busy || !valid;
  elements.activateButton.disabled = busy || !valid || appSettings.activeProviderId === currentProviderId;
  elements.activateButton.textContent = appSettings.activeProviderId === currentProviderId ? "当前提供商" : "设为当前";
  elements.clearProviderButton.disabled = busy;

  if (manualMode) {
    elements.modelMeta.textContent = currentProviderId === "volcengine"
      ? "可填写火山方舟模型 ID 或推理接入点 ID"
      : "手动模型不会通过模型列表验证";
  } else if (!config.apiKey) {
    elements.modelMeta.textContent = "填写 API Key 后获取模型列表";
  } else if (!listTrusted) {
    elements.modelMeta.textContent = "连接配置已变化，请重新获取模型列表";
  } else {
    elements.modelMeta.textContent = formatFetchedAt(config.modelsFetchedAt, config.availableModels.length);
  }
}

function loadProvider(providerId) {
  // Provider switches discard unsaved form edits by reloading the stored snapshot.
  currentProviderId = providerId;
  workingConfig = normalizeProviderConfig(appSettings.providers[providerId], providerId);
  const provider = resolveProvider(providerId, workingConfig);
  validatedFingerprint = workingConfig.availableModels.length ? providerFingerprint(workingConfig, provider) : "";

  const isCustom = isCustomProviderId(providerId);
  elements.apiKey.value = workingConfig.apiKey;
  elements.apiKey.type = "password";
  elements.customName.value = isCustom ? workingConfig.name : "";
  elements.baseUrl.value = isCustom ? workingConfig.baseUrl : "";
  elements.modelsPath.value = isCustom ? workingConfig.modelsPath : "/models";
  elements.chatPath.value = isCustom ? workingConfig.chatPath : "/chat/completions";
  elements.supportsModelDiscovery.checked = isCustom ? workingConfig.supportsModelDiscovery : true;
  elements.manualModelToggle.checked = workingConfig.modelSelectionMode === "manual";
  elements.manualModelInput.value = workingConfig.manualModel;
  populateModels(workingConfig.availableModels, workingConfig.selectedModel);
  setStatus("");
  populateProviderSelect();
  renderState();
}

async function ensureCustomPermission(config) {
  // Built-ins are declared in host_permissions; custom origins are requested lazily.
  if (!isCustomProviderId(currentProviderId)) return true;
  const origin = getOriginPattern(config.baseUrl);
  if (!origin) return false;
  return chrome.permissions.request({ origins: [origin] });
}

async function persistDraft({ activate = false } = {}) {
  // Saving and activating are distinct operations so users can prepare providers.
  const config = getDraftConfig();
  const provider = currentProvider(config);
  const valid = isProviderConfigurationValid(config, currentProviderId) &&
    (config.modelSelectionMode === "manual" || isListTrusted(config, provider));
  if (!valid) {
    setStatus("请完成连接配置并选择或填写有效模型。", true);
    return false;
  }
  if (!await ensureCustomPermission(config)) {
    setStatus("未获得自定义接口域名的访问权限。", true);
    return false;
  }

  workingConfig = config;
  appSettings.providers[currentProviderId] = config;
  if (activate) appSettings.activeProviderId = currentProviderId;
  await saveSettings(appSettings);
  appSettings = normalizeSettings(appSettings);
  populateProviderSelect();
  renderState();
  setStatus(activate ? `${provider.name}已设为当前提供商。` : `${provider.name}配置已保存。`);
  return true;
}

async function handleFetchModels() {
  // Clicking the same button while a request is active acts as explicit cancel.
  if (fetchController) {
    fetchStopReason = "user";
    fetchController.abort();
    return;
  }
  const config = getDraftConfig();
  const provider = currentProvider(config);
  if (!provider || !config.apiKey) {
    setStatus("请先填写有效的接口地址和 API Key。", true);
    return;
  }
  if (!await ensureCustomPermission(config)) {
    setStatus("未获得自定义接口域名的访问权限。", true);
    return;
  }

  fetchController = new AbortController();
  fetchStopReason = "";
  setStatus(`正在从${provider.name}获取模型…`);
  renderState();
  const timeoutId = setTimeout(() => {
    fetchStopReason = "timeout";
    fetchController?.abort();
  }, MODEL_FETCH_TIMEOUT_MS);

  try {
    const models = await fetchModels({ provider, apiKey: config.apiKey, signal: fetchController.signal });
    const missingSelectedModel = Boolean(config.selectedModel && !models.includes(config.selectedModel));
    const selectedModel = models.includes(config.selectedModel)
      ? config.selectedModel
      : !missingSelectedModel && models.includes(provider.defaultModel)
        ? provider.defaultModel
        : "";
    // Commit discovery only after a complete valid response. Existing persisted
    // configuration remains untouched when the request fails or is cancelled.
    workingConfig = normalizeProviderConfig({
      ...config,
      selectedModel,
      availableModels: models,
      modelsFetchedAt: Date.now()
    }, currentProviderId);
    validatedFingerprint = providerFingerprint(workingConfig, provider);
    populateModels(models, selectedModel);
    setStatus(missingSelectedModel
      ? `原模型 ${config.selectedModel} 已不可用，请重新选择。`
      : `已获取 ${models.length} 个${provider.name}模型。`, missingSelectedModel);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus(fetchStopReason === "timeout" ? "获取模型列表超时，可以改用手动模型。" : "已取消获取模型列表。", fetchStopReason === "timeout");
    } else {
      setStatus(`${error.message} 可以改用手动模型。`, true);
    }
  } finally {
    clearTimeout(timeoutId);
    fetchController = null;
    fetchStopReason = "";
    renderState();
  }
}

async function addCustomProvider() {
  // Persist the empty shell immediately so it remains selectable across reloads.
  const providerId = `custom:${crypto.randomUUID()}`;
  appSettings.providers[providerId] = normalizeProviderConfig({
    type: "custom",
    name: "新自定义提供商",
    baseUrl: "",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    supportsModelDiscovery: true,
    modelSelectionMode: "list"
  }, providerId);
  await saveSettings(appSettings);
  loadProvider(providerId);
  elements.customName.select();
}

async function selectProvider(value) {
  if (value === ADD_CUSTOM_PROVIDER) {
    await addCustomProvider();
    return;
  }
  loadProvider(value);
}

async function deleteCustomProvider() {
  if (!isCustomProviderId(currentProviderId)) return;
  const removedConfig = appSettings.providers[currentProviderId];
  const origin = getOriginPattern(removedConfig.baseUrl);
  delete appSettings.providers[currentProviderId];
  if (appSettings.activeProviderId === currentProviderId) appSettings.activeProviderId = DEFAULT_PROVIDER_ID;
  await saveSettings(appSettings);

  if (origin) {
    // Revoke an optional origin only when no other custom provider still uses it.
    const stillUsed = Object.entries(appSettings.providers).some(([id, config]) =>
      isCustomProviderId(id) && getOriginPattern(config.baseUrl) === origin
    );
    if (!stillUsed) await chrome.permissions.remove({ origins: [origin] });
  }
  loadProvider(appSettings.activeProviderId);
  setStatus("自定义提供商已删除。");
}

async function clearCurrentProvider() {
  // Clearing credentials preserves custom endpoint metadata for easy reconfiguration.
  const old = getDraftConfig();
  workingConfig = normalizeProviderConfig(isCustomProviderId(currentProviderId) ? {
    type: "custom",
    name: old.name,
    baseUrl: old.baseUrl,
    modelsPath: old.modelsPath,
    chatPath: old.chatPath,
    supportsModelDiscovery: old.supportsModelDiscovery
  } : null, currentProviderId);
  appSettings.providers[currentProviderId] = workingConfig;
  await saveSettings(appSettings);
  loadProvider(currentProviderId);
  setStatus("当前提供商的 API Key 和模型配置已清除。");
}

// Event wiring is kept at the bottom to make startup order explicit.
elements.providerSelect.addEventListener("change", () => selectProvider(elements.providerSelect.value));
elements.deleteCustomButton.addEventListener("click", deleteCustomProvider);
elements.settingsForm.addEventListener("submit", (event) => { event.preventDefault(); persistDraft(); });
elements.activateButton.addEventListener("click", () => persistDraft({ activate: true }));
elements.fetchModelsButton.addEventListener("click", handleFetchModels);
elements.clearProviderButton.addEventListener("click", clearCurrentProvider);
elements.toggleVisibility.addEventListener("click", () => {
  const show = elements.apiKey.type === "password";
  elements.apiKey.type = show ? "text" : "password";
  elements.toggleVisibility.title = show ? "隐藏 API Key" : "显示 API Key";
  elements.toggleVisibility.setAttribute("aria-label", elements.toggleVisibility.title);
});

const watchedInputs = [
  elements.apiKey,
  elements.customName,
  elements.baseUrl,
  elements.modelsPath,
  elements.chatPath,
  elements.supportsModelDiscovery,
  elements.manualModelToggle,
  elements.modelSelect,
  elements.manualModelInput
];
for (const input of watchedInputs) {
  input.addEventListener("input", () => { setStatus(""); renderState(); });
  input.addEventListener("change", () => { setStatus(""); renderState(); });
}

getSettings().then((settings) => {
  appSettings = settings;
  loadProvider(settings.activeProviderId);
}).catch((error) => {
  setStatus(`读取设置失败：${error.message}`, true);
});
