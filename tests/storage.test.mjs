import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptySettings,
  getEffectiveModel,
  getSettings,
  isProviderConfigurationValid,
  normalizeModelList,
  normalizeProviderConfig,
  normalizeSettings,
  selectAvailableModel
} from "../shared/storage.js";

const originalChrome = globalThis.chrome;
afterEach(() => { globalThis.chrome = originalChrome; });

test("normalizeModelList removes invalid and duplicate values", () => {
  assert.deepEqual(normalizeModelList(["z-model", " a-model ", "a-model", "", null]), ["a-model", "z-model"]);
});

test("new settings contain all built-in providers", () => {
  const settings = createEmptySettings();
  assert.equal(settings.version, 2);
  assert.equal(settings.activeProviderId, "deepseek");
  assert.deepEqual(Object.keys(settings.providers), ["deepseek", "qwen-cn", "qwen-intl", "volcengine"]);
});

test("getSettings migrates legacy DeepSeek settings and retains the old key", async () => {
  const legacy = { apiKey: " sk-legacy ", selectedModel: "deepseek-chat", availableModels: ["deepseek-chat"] };
  const localStore = { deepseekSettings: legacy };
  globalThis.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.filter((key) => key in localStore).map((key) => [key, localStore[key]])); },
      async set(values) { Object.assign(localStore, values); }
    } }
  };
  const settings = await getSettings();
  assert.equal(settings.providers.deepseek.apiKey, "sk-legacy");
  assert.equal(settings.providers.deepseek.selectedModel, "deepseek-chat");
  assert.equal(isProviderConfigurationValid(settings.providers.deepseek, "deepseek"), true);
  assert.strictEqual(localStore.deepseekSettings, legacy);
  assert.deepEqual(localStore.sidebarAgentSettings, settings);
});

test("list mode rejects a selected model absent from the cached list", () => {
  const config = normalizeProviderConfig({
    apiKey: "sk-test",
    selectedModel: "retired-model",
    availableModels: ["deepseek-chat"]
  }, "deepseek");
  assert.equal(isProviderConfigurationValid(config, "deepseek"), false);
});

test("manual mode accepts a model without a fetched list", () => {
  const config = normalizeProviderConfig({ apiKey: "key", modelSelectionMode: "manual", manualModel: "ep-123" }, "volcengine");
  assert.equal(getEffectiveModel(config), "ep-123");
  assert.equal(isProviderConfigurationValid(config, "volcengine"), true);
});

test("selectAvailableModel updates only an available list model", () => {
  const settings = createEmptySettings();
  settings.providers.deepseek = normalizeProviderConfig({
    apiKey: "key",
    selectedModel: "deepseek-chat",
    availableModels: ["deepseek-chat", "deepseek-reasoner"]
  }, "deepseek");
  const updated = selectAvailableModel(settings, "deepseek", "deepseek-reasoner");
  assert.equal(updated.providers.deepseek.selectedModel, "deepseek-reasoner");
  assert.equal(settings.providers.deepseek.selectedModel, "deepseek-chat");
  assert.throws(() => selectAvailableModel(settings, "deepseek", "missing-model"), RangeError);
});

test("custom providers are normalized and retained", () => {
  const settings = normalizeSettings({
    version: 2,
    activeProviderId: "custom:one",
    providers: {
      "custom:one": {
        name: " Local AI ", baseUrl: "http://localhost:11434/v1/", apiKey: "key",
        modelSelectionMode: "manual", manualModel: "model", modelsPath: "models", chatPath: "chat/completions"
      }
    }
  });
  const config = settings.providers["custom:one"];
  assert.equal(settings.activeProviderId, "custom:one");
  assert.equal(config.name, "Local AI");
  assert.equal(config.baseUrl, "http://localhost:11434/v1");
  assert.equal(config.chatPath, "/chat/completions");
  assert.equal(isProviderConfigurationValid(config, "custom:one"), true);
});
