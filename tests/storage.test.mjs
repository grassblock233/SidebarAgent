import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getSettings,
  isConfigurationValid,
  normalizeModelList,
  normalizeSettings
} from "../shared/storage.js";

const originalChrome = globalThis.chrome;

afterEach(() => {
  globalThis.chrome = originalChrome;
});

test("normalizeModelList removes invalid and duplicate values", () => {
  assert.deepEqual(
    normalizeModelList(["z-model", " a-model ", "a-model", "", null]),
    ["a-model", "z-model"]
  );
});

test("normalizeSettings keeps a new empty configuration incomplete", () => {
  assert.deepEqual(normalizeSettings(null), {
    apiKey: "",
    selectedModel: "",
    availableModels: [],
    modelsFetchedAt: null
  });
});

test("getSettings migrates legacy API-key-only settings", async () => {
  const localStore = { deepseekSettings: { apiKey: " sk-legacy " } };
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: localStore[key] }; },
        async set(values) { Object.assign(localStore, values); }
      }
    }
  };

  const settings = await getSettings();
  assert.equal(settings.apiKey, "sk-legacy");
  assert.equal(settings.selectedModel, "deepseek-chat");
  assert.deepEqual(settings.availableModels, ["deepseek-chat"]);
  assert.deepEqual(localStore.deepseekSettings, settings);
  assert.equal(isConfigurationValid(settings), true);
});

test("configuration is invalid when the selected model is absent", () => {
  assert.equal(isConfigurationValid({
    apiKey: "sk-test",
    selectedModel: "retired-model",
    availableModels: ["deepseek-chat"],
    modelsFetchedAt: Date.now()
  }), false);
});
