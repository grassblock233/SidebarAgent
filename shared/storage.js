// Central storage boundary. Every value is normalized on both read and write so
// malformed or older browser data cannot leak unchecked into request code.
import {
  DEFAULT_PROVIDER_ID,
  LEGACY_SETTINGS_KEY,
  PENDING_SELECTION_KEY,
  SESSION_KEY,
  SETTINGS_KEY,
  SETTINGS_VERSION
} from "./constants.js";
import {
  BUILTIN_PROVIDER_IDS,
  BUILTIN_PROVIDERS,
  isCustomProviderId,
  normalizeApiPath,
  normalizeBaseUrl,
  validateCustomBaseUrl
} from "./providers.js";

export function normalizeModelList(models) {
  if (!Array.isArray(models)) return [];
  return [...new Set(
    models.filter((model) => typeof model === "string").map((model) => model.trim()).filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en"));
}

export function normalizeProviderConfig(config, providerId) {
  const stored = config && typeof config === "object" ? config : {};
  const modelSelectionMode = stored.modelSelectionMode === "manual" ? "manual" : "list";
  const normalized = {
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey.trim() : "",
    modelSelectionMode,
    selectedModel: typeof stored.selectedModel === "string" ? stored.selectedModel.trim() : "",
    manualModel: typeof stored.manualModel === "string" ? stored.manualModel.trim() : "",
    availableModels: normalizeModelList(stored.availableModels),
    modelsFetchedAt: Number.isFinite(stored.modelsFetchedAt) && stored.modelsFetchedAt > 0
      ? stored.modelsFetchedAt
      : null
  };

  // Built-in endpoints are immutable; custom providers retain connection fields.
  if (!isCustomProviderId(providerId)) return normalized;
  return {
    ...normalized,
    type: "custom",
    name: typeof stored.name === "string" ? stored.name.trim() : "",
    baseUrl: normalizeBaseUrl(stored.baseUrl),
    modelsPath: normalizeApiPath(stored.modelsPath, "/models"),
    chatPath: normalizeApiPath(stored.chatPath, "/chat/completions"),
    supportsModelDiscovery: stored.supportsModelDiscovery !== false
  };
}

export function createEmptySettings() {
  const providers = {};
  for (const providerId of BUILTIN_PROVIDER_IDS) {
    providers[providerId] = normalizeProviderConfig(null, providerId);
  }
  return { version: SETTINGS_VERSION, activeProviderId: DEFAULT_PROVIDER_ID, providers };
}

export function normalizeSettings(storedSettings) {
  const normalized = createEmptySettings();
  if (!storedSettings || typeof storedSettings !== "object") return normalized;

  const storedProviders = storedSettings.providers && typeof storedSettings.providers === "object"
    ? storedSettings.providers
    : {};
  // Always materialize built-ins so newly added providers appear after upgrades.
  for (const providerId of BUILTIN_PROVIDER_IDS) {
    normalized.providers[providerId] = normalizeProviderConfig(storedProviders[providerId], providerId);
  }
  for (const [providerId, config] of Object.entries(storedProviders)) {
    if (isCustomProviderId(providerId)) normalized.providers[providerId] = normalizeProviderConfig(config, providerId);
  }

  normalized.activeProviderId = Object.hasOwn(normalized.providers, storedSettings.activeProviderId)
    ? storedSettings.activeProviderId
    : DEFAULT_PROVIDER_ID;
  return normalized;
}

export function getEffectiveModel(config) {
  return config?.modelSelectionMode === "manual" ? config.manualModel?.trim() || "" : config?.selectedModel?.trim() || "";
}

export function isProviderConfigurationValid(config, providerId) {
  const normalized = normalizeProviderConfig(config, providerId);
  if (!normalized.apiKey || !getEffectiveModel(normalized)) return false;
  // List mode accepts only models verified by the last successful discovery call.
  if (normalized.modelSelectionMode === "list" && !normalized.availableModels.includes(normalized.selectedModel)) return false;
  if (isCustomProviderId(providerId)) {
    return Boolean(normalized.name && validateCustomBaseUrl(normalized.baseUrl).valid);
  }
  return true;
}

export function selectAvailableModel(storedSettings, providerId, model) {
  // Normalize a copy first; model switching must not mutate caller-owned state.
  const settings = normalizeSettings(storedSettings);
  const config = settings.providers[providerId];
  const selectedModel = typeof model === "string" ? model.trim() : "";
  if (!config || config.modelSelectionMode !== "list" || !config.apiKey || !config.availableModels.includes(selectedModel)) {
    throw new RangeError("所选模型不在当前提供商的可用模型列表中。");
  }
  settings.providers[providerId] = normalizeProviderConfig({ ...config, selectedModel }, providerId);
  return settings;
}

function migrateLegacySettings(legacy) {
  // Versions before multi-provider support stored a single DeepSeek config.
  const settings = createEmptySettings();
  if (!legacy || typeof legacy !== "object" || typeof legacy.apiKey !== "string" || !legacy.apiKey.trim()) return settings;
  const availableModels = normalizeModelList(legacy.availableModels);
  const selectedModel = typeof legacy.selectedModel === "string" && legacy.selectedModel.trim()
    ? legacy.selectedModel.trim()
    : BUILTIN_PROVIDERS.deepseek.defaultModel;
  settings.providers.deepseek = normalizeProviderConfig({
    apiKey: legacy.apiKey,
    modelSelectionMode: "list",
    selectedModel,
    availableModels: availableModels.includes(selectedModel) ? availableModels : [...availableModels, selectedModel],
    modelsFetchedAt: legacy.modelsFetchedAt
  }, "deepseek");
  return settings;
}

export async function getSettings() {
  const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  if (result[SETTINGS_KEY]) return normalizeSettings(result[SETTINGS_KEY]);
  // Persist migration once so subsequent reads use the current schema directly.
  const migrated = migrateLegacySettings(result[LEGACY_SETTINGS_KEY]);
  await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
  return migrated;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export async function clearSettings() {
  await chrome.storage.local.remove([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
}

export async function getPendingSelection() {
  // Session storage intentionally clears browsing context when Chrome exits.
  const result = await chrome.storage.session.get(PENDING_SELECTION_KEY);
  return result[PENDING_SELECTION_KEY] || null;
}

export async function getConversationSession() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] || null;
}

export async function saveConversationSession(session) {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

export async function clearConversationSession() {
  await chrome.storage.session.remove([SESSION_KEY, PENDING_SELECTION_KEY]);
}
