import { DEFAULT_PROVIDER_ID, LEGACY_SETTINGS_KEY, PENDING_SELECTION_KEY, SESSION_KEY, SETTINGS_KEY, SETTINGS_VERSION } from "./constants";
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDERS, isCustomProviderId, normalizeApiPath, normalizeBaseUrl, validateCustomBaseUrl } from "./providers";
import type { ConversationSession, CustomProviderConfig, ProviderConfig, ProviderId, SidebarAgentSettingsV2, SourceContext } from "./types";

type UnknownRecord = Record<string, unknown>;

export function normalizeModelList(models: unknown): string[] {
  if (!Array.isArray(models)) return [];
  return [...new Set(models.filter((model): model is string => typeof model === "string").map((model) => model.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function normalizeProviderConfig(config: unknown, providerId: ProviderId): ProviderConfig | CustomProviderConfig {
  const stored = config && typeof config === "object" ? config as UnknownRecord : {};
  const normalized: ProviderConfig = {
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey.trim() : "",
    modelSelectionMode: stored.modelSelectionMode === "manual" ? "manual" : "list",
    selectedModel: typeof stored.selectedModel === "string" ? stored.selectedModel.trim() : "",
    manualModel: typeof stored.manualModel === "string" ? stored.manualModel.trim() : "",
    availableModels: normalizeModelList(stored.availableModels),
    modelsFetchedAt: typeof stored.modelsFetchedAt === "number" && Number.isFinite(stored.modelsFetchedAt) && stored.modelsFetchedAt > 0 ? stored.modelsFetchedAt : null
  };
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

export function createEmptySettings(): SidebarAgentSettingsV2 {
  const providers: SidebarAgentSettingsV2["providers"] = {};
  for (const providerId of BUILTIN_PROVIDER_IDS) providers[providerId] = normalizeProviderConfig(null, providerId);
  return { version: SETTINGS_VERSION, activeProviderId: DEFAULT_PROVIDER_ID, providers };
}

export function normalizeSettings(storedSettings: unknown): SidebarAgentSettingsV2 {
  const normalized = createEmptySettings();
  if (!storedSettings || typeof storedSettings !== "object") return normalized;
  const stored = storedSettings as UnknownRecord;
  const storedProviders = stored.providers && typeof stored.providers === "object" ? stored.providers as Record<string, unknown> : {};
  for (const providerId of BUILTIN_PROVIDER_IDS) normalized.providers[providerId] = normalizeProviderConfig(storedProviders[providerId], providerId);
  for (const [providerId, config] of Object.entries(storedProviders)) {
    if (isCustomProviderId(providerId)) normalized.providers[providerId] = normalizeProviderConfig(config, providerId);
  }
  normalized.activeProviderId = typeof stored.activeProviderId === "string" && Object.hasOwn(normalized.providers, stored.activeProviderId)
    ? stored.activeProviderId as ProviderId
    : DEFAULT_PROVIDER_ID;
  return normalized;
}

export function getEffectiveModel(config?: ProviderConfig): string {
  return config?.modelSelectionMode === "manual" ? config.manualModel.trim() : config?.selectedModel.trim() || "";
}

export function isProviderConfigurationValid(config: unknown, providerId: ProviderId): boolean {
  const normalized = normalizeProviderConfig(config, providerId);
  if (!normalized.apiKey || !getEffectiveModel(normalized)) return false;
  if (normalized.modelSelectionMode === "list" && !normalized.availableModels.includes(normalized.selectedModel)) return false;
  if (isCustomProviderId(providerId)) {
    const custom = normalized as CustomProviderConfig;
    return Boolean(custom.name && validateCustomBaseUrl(custom.baseUrl).valid);
  }
  return true;
}

export function selectAvailableModel(storedSettings: unknown, providerId: ProviderId, model: string): SidebarAgentSettingsV2 {
  const settings = normalizeSettings(storedSettings);
  const config = settings.providers[providerId];
  const selectedModel = model.trim();
  if (!config || config.modelSelectionMode !== "list" || !config.apiKey || !config.availableModels.includes(selectedModel)) {
    throw new RangeError("所选模型不在当前提供商的可用模型列表中。");
  }
  settings.providers[providerId] = normalizeProviderConfig({ ...config, selectedModel }, providerId);
  return settings;
}

function migrateLegacySettings(legacy: unknown): SidebarAgentSettingsV2 {
  const settings = createEmptySettings();
  if (!legacy || typeof legacy !== "object") return settings;
  const value = legacy as UnknownRecord;
  if (typeof value.apiKey !== "string" || !value.apiKey.trim()) return settings;
  const availableModels = normalizeModelList(value.availableModels);
  const selectedModel = typeof value.selectedModel === "string" && value.selectedModel.trim() ? value.selectedModel.trim() : BUILTIN_PROVIDERS.deepseek.defaultModel;
  settings.providers.deepseek = normalizeProviderConfig({
    apiKey: value.apiKey,
    modelSelectionMode: "list",
    selectedModel,
    availableModels: availableModels.includes(selectedModel) ? availableModels : [...availableModels, selectedModel],
    modelsFetchedAt: value.modelsFetchedAt
  }, "deepseek");
  return settings;
}

export async function getSettings(): Promise<SidebarAgentSettingsV2> {
  const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
  if (result[SETTINGS_KEY]) return normalizeSettings(result[SETTINGS_KEY]);
  const migrated = migrateLegacySettings(result[LEGACY_SETTINGS_KEY]);
  await chrome.storage.local.set({ [SETTINGS_KEY]: migrated });
  return migrated;
}

export async function saveSettings(settings: SidebarAgentSettingsV2): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export async function clearSettings(): Promise<void> {
  await chrome.storage.local.remove([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
}

export async function getPendingSelection(): Promise<SourceContext | null> {
  const result = await chrome.storage.session.get(PENDING_SELECTION_KEY);
  return result[PENDING_SELECTION_KEY] as SourceContext | null || null;
}

export async function getConversationSession(): Promise<ConversationSession | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] as ConversationSession | null || null;
}

export async function saveConversationSession(session: ConversationSession): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
}

export async function clearConversationSession(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY, PENDING_SELECTION_KEY]);
}
