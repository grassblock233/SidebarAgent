import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_PROVIDERS,
  buildApiUrl,
  getOriginPattern,
  resolveProvider,
  validateCustomBaseUrl
} from "../shared/providers.js";

test("built-in providers resolve their OpenAI-compatible URLs", () => {
  assert.equal(buildApiUrl(BUILTIN_PROVIDERS.deepseek.baseUrl, BUILTIN_PROVIDERS.deepseek.chatPath), "https://api.deepseek.com/chat/completions");
  assert.equal(buildApiUrl(BUILTIN_PROVIDERS["qwen-cn"].baseUrl, "/models"), "https://dashscope.aliyuncs.com/compatible-mode/v1/models");
  assert.equal(buildApiUrl(BUILTIN_PROVIDERS["qwen-intl"].baseUrl, "/models"), "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models");
  assert.equal(buildApiUrl(BUILTIN_PROVIDERS.volcengine.baseUrl, "/chat/completions"), "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
});

test("custom URLs require HTTPS except for supported local hosts", () => {
  assert.equal(validateCustomBaseUrl("https://example.com/v1").valid, true);
  assert.equal(validateCustomBaseUrl("http://localhost:11434/v1").valid, true);
  assert.equal(validateCustomBaseUrl("http://127.0.0.1:8080/v1").valid, true);
  assert.equal(validateCustomBaseUrl("http://example.com/v1").valid, false);
  assert.equal(validateCustomBaseUrl("not a url").valid, false);
});

test("custom providers normalize paths and generate narrow permission patterns", () => {
  const provider = resolveProvider("custom:test", {
    name: "My API", baseUrl: "https://example.com/v1/", modelsPath: "models", chatPath: "chat/completions"
  });
  assert.equal(provider.baseUrl, "https://example.com/v1");
  assert.equal(provider.modelsPath, "/models");
  assert.equal(getOriginPattern("https://example.com/v1"), "https://example.com/*");
  assert.equal(getOriginPattern("http://localhost:11434/v1"), "http://localhost/*");
});
