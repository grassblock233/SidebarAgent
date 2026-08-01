import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ProviderError,
  describeApiError,
  fetchModels,
  readSseData,
  streamChat
} from "../shared/openai-compatible-client.js";
import { BUILTIN_PROVIDERS } from "../shared/providers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    }
  });
}

test("readSseData handles chunk boundaries, CRLF and multi-line data", async () => {
  const stream = streamFromChunks([
    "data: {\"choices\":[{\"delta\":{\"content\":\"你",
    "好\"}}]}\r\n\r\n",
    "data: first\ndata: second\n\n",
    "data: [DONE]\r\n\r\n"
  ]);
  const events = [];
  for await (const data of readSseData(stream)) events.push(data);
  assert.deepEqual(events, [
    "{\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}",
    "first\nsecond",
    "[DONE]"
  ]);
});

test("fetchModels authenticates and normalizes model ids", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://dashscope.aliyuncs.com/compatible-mode/v1/models");
    assert.equal(options.headers.Authorization, "Bearer sk-test");
    return new Response(JSON.stringify({
      data: [{ id: "qwen-plus" }, { id: " qwen-max " }, { id: "qwen-plus" }, null, {}]
    }), { status: 200 });
  };
  const models = await fetchModels({ provider: BUILTIN_PROVIDERS["qwen-cn"], apiKey: "sk-test" });
  assert.deepEqual(models, ["qwen-max", "qwen-plus"]);
});

test("fetchModels rejects empty, malformed and invalid JSON responses", async (context) => {
  const provider = BUILTIN_PROVIDERS.deepseek;
  for (const [name, body, code] of [
    ["empty", JSON.stringify({ data: [] }), "empty-models"],
    ["invalid shape", JSON.stringify({ models: [] }), "parse"],
    ["invalid json", "not json", "parse"]
  ]) {
    await context.test(name, async () => {
      globalThis.fetch = async () => new Response(body, { status: 200 });
      await assert.rejects(fetchModels({ provider, apiKey: "sk-test" }), (error) => error.code === code);
    });
  }
});

test("API and network errors are provider-aware and do not expose credentials", async (context) => {
  const provider = BUILTIN_PROVIDERS.volcengine;
  for (const [status, expected] of [[401, /API Key/], [429, /频繁/], [503, /暂时不可用/]]) {
    await context.test(`HTTP ${status}`, async () => {
      globalThis.fetch = async () => new Response("", { status });
      await assert.rejects(fetchModels({ provider, apiKey: "sk-secret" }), (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /sk-secret/);
        return true;
      });
    });
  }
  await context.test("network failure", async () => {
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(fetchModels({ provider, apiKey: "sk-secret" }), (error) => error.code === "network");
  });
});

test("fetchModels preserves AbortError", async () => {
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  const controller = new AbortController();
  const request = fetchModels({
    provider: BUILTIN_PROVIDERS.deepseek,
    apiKey: "sk-test",
    signal: controller.signal
  });
  controller.abort();
  await assert.rejects(request, (error) => error.name === "AbortError");
});

test("streamChat uses the provider chat URL and selected model", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    const request = JSON.parse(options.body);
    assert.equal(request.model, "qwen-plus");
    return new Response(streamFromChunks([
      "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n",
      "data: [DONE]\n\n"
    ]), { status: 200 });
  };
  let answer = "";
  await streamChat({
    provider: BUILTIN_PROVIDERS["qwen-intl"],
    apiKey: "sk-test",
    model: "qwen-plus",
    messages: [{ role: "user", content: "question" }],
    onDelta(delta) { answer += delta; }
  });
  assert.equal(answer, "answer");
});

test("streamChat rejects a missing model", async () => {
  await assert.rejects(
    streamChat({ provider: BUILTIN_PROVIDERS.deepseek, apiKey: "sk-test", model: "", messages: [], onDelta() {} }),
    (error) => error instanceof ProviderError && error.code === "configuration"
  );
});

test("describeApiError maps common statuses with a provider name", () => {
  assert.match(describeApiError("千问", 401), /千问.*API Key/);
  assert.match(describeApiError("千问", 402), /余额/);
  assert.match(describeApiError("千问", 429), /频繁/);
  assert.match(describeApiError("千问", 503), /暂时不可用/);
  assert.match(describeApiError("千问", 400, "invalid request"), /invalid request/);
});
