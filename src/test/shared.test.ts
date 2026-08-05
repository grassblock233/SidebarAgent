import { beforeEach, describe, expect, it } from "vitest";
import { LEGACY_SETTINGS_KEY, SETTINGS_KEY } from "../shared/constants";
import { BUILTIN_PROVIDERS, buildApiUrl, getOriginPattern, resolveProvider, validateCustomBaseUrl } from "../shared/providers";
import { createEmptySettings, getEffectiveModel, getSettings, isProviderConfigurationValid, normalizeModelList, normalizeProviderConfig, normalizeSettings, selectAvailableModel } from "../shared/storage";
import { chromeTestState } from "./setup";

beforeEach(() => {
  for (const store of [chromeTestState.localStore, chromeTestState.sessionStore]) for (const key of Object.keys(store)) delete store[key];
});

describe("provider definitions", () => {
  it("builds all built-in OpenAI-compatible URLs", () => {
    expect(buildApiUrl(BUILTIN_PROVIDERS.deepseek.baseUrl, BUILTIN_PROVIDERS.deepseek.chatPath)).toBe("https://api.deepseek.com/chat/completions");
    expect(buildApiUrl(BUILTIN_PROVIDERS["qwen-cn"].baseUrl, "/models")).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    expect(buildApiUrl(BUILTIN_PROVIDERS.volcengine.baseUrl, "/chat/completions")).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  });

  it("allows HTTPS and local HTTP only", () => {
    expect(validateCustomBaseUrl("https://example.com/v1").valid).toBe(true);
    expect(validateCustomBaseUrl("http://localhost:11434/v1").valid).toBe(true);
    expect(validateCustomBaseUrl("http://127.0.0.1/v1").valid).toBe(true);
    expect(validateCustomBaseUrl("http://example.com/v1").valid).toBe(false);
    expect(validateCustomBaseUrl("not a url").valid).toBe(false);
  });

  it("normalizes custom endpoints and narrows origin permissions", () => {
    const config = normalizeProviderConfig({ name: "My API", baseUrl: "https://example.com/v1/", modelsPath: "models", chatPath: "chat/completions" }, "custom:test");
    const provider = resolveProvider("custom:test", config)!;
    expect(provider.baseUrl).toBe("https://example.com/v1");
    expect(provider.modelsPath).toBe("/models");
    expect(getOriginPattern(provider.baseUrl)).toBe("https://example.com/*");
  });
});

describe("settings normalization", () => {
  it("deduplicates and sorts model IDs", () => expect(normalizeModelList(["z", " a ", "a", "", null])).toEqual(["a", "z"]));

  it("materializes every built-in provider", () => {
    const settings = createEmptySettings();
    expect(settings.version).toBe(2);
    expect(Object.keys(settings.providers)).toEqual(["deepseek", "qwen-cn", "qwen-intl", "volcengine"]);
  });

  it("migrates legacy DeepSeek data without deleting the old key", async () => {
    const legacy = { apiKey: " sk-legacy ", selectedModel: "deepseek-chat", availableModels: ["deepseek-chat"] };
    chromeTestState.localStore[LEGACY_SETTINGS_KEY] = legacy;
    const settings = await getSettings();
    expect(settings.providers.deepseek.apiKey).toBe("sk-legacy");
    expect(chromeTestState.localStore[LEGACY_SETTINGS_KEY]).toBe(legacy);
    expect(chromeTestState.localStore[SETTINGS_KEY]).toEqual(settings);
  });

  it("rejects stale list models and accepts manual models", () => {
    const stale = normalizeProviderConfig({ apiKey: "key", selectedModel: "old", availableModels: ["new"] }, "deepseek");
    expect(isProviderConfigurationValid(stale, "deepseek")).toBe(false);
    const manual = normalizeProviderConfig({ apiKey: "key", modelSelectionMode: "manual", manualModel: "ep-123" }, "volcengine");
    expect(getEffectiveModel(manual)).toBe("ep-123");
    expect(isProviderConfigurationValid(manual, "volcengine")).toBe(true);
  });

  it("switches only to available models without mutating the input", () => {
    const settings = createEmptySettings();
    settings.providers.deepseek = normalizeProviderConfig({ apiKey: "key", selectedModel: "a", availableModels: ["a", "b"] }, "deepseek");
    const updated = selectAvailableModel(settings, "deepseek", "b");
    expect(updated.providers.deepseek.selectedModel).toBe("b");
    expect(settings.providers.deepseek.selectedModel).toBe("a");
    expect(() => selectAvailableModel(settings, "deepseek", "missing")).toThrow(RangeError);
  });

  it("retains normalized custom providers", () => {
    const settings = normalizeSettings({ activeProviderId: "custom:one", providers: { "custom:one": { name: " Local AI ", baseUrl: "http://localhost:11434/v1/", apiKey: "key", modelSelectionMode: "manual", manualModel: "model", modelsPath: "models", chatPath: "chat/completions" } } });
    expect(settings.activeProviderId).toBe("custom:one");
    expect((settings.providers["custom:one"] as { name: string }).name).toBe("Local AI");
    expect(isProviderConfigurationValid(settings.providers["custom:one"], "custom:one")).toBe(true);
  });
});
