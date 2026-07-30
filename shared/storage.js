import {
  DEFAULT_MODEL,
  PENDING_SELECTION_KEY,
  SESSION_KEY,
  SETTINGS_KEY
} from "./constants.js";

export function normalizeModelList(models) {
  if (!Array.isArray(models)) return [];
  return [...new Set(
    models
      .filter((model) => typeof model === "string")
      .map((model) => model.trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en"));
}

export function normalizeSettings(storedSettings) {
  const stored = storedSettings && typeof storedSettings === "object" ? storedSettings : {};
  const apiKey = typeof stored.apiKey === "string" ? stored.apiKey.trim() : "";
  const isLegacy = Boolean(apiKey) && !Object.hasOwn(stored, "selectedModel");
  let selectedModel = typeof stored.selectedModel === "string" ? stored.selectedModel.trim() : "";
  let availableModels = normalizeModelList(stored.availableModels);

  if (isLegacy) {
    selectedModel = DEFAULT_MODEL;
    availableModels = normalizeModelList([...availableModels, DEFAULT_MODEL]);
  }

  return {
    apiKey,
    selectedModel,
    availableModels,
    modelsFetchedAt: Number.isFinite(stored.modelsFetchedAt) && stored.modelsFetchedAt > 0
      ? stored.modelsFetchedAt
      : null
  };
}

export function isConfigurationValid(settings) {
  const normalized = normalizeSettings(settings);
  return Boolean(
    normalized.apiKey &&
    normalized.selectedModel &&
    normalized.availableModels.includes(normalized.selectedModel)
  );
}

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];
  const normalized = normalizeSettings(stored);

  if (stored?.apiKey && !Object.hasOwn(stored, "selectedModel")) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  }

  return normalized;
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
}

export async function clearSettings() {
  await chrome.storage.local.remove(SETTINGS_KEY);
}

export async function getPendingSelection() {
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
