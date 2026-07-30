import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  DeepSeekError,
  describeApiError,
  fetchModels,
  readSseData,
  streamChat
} from "../shared/deepseek-client.js";

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

test("readSseData handles chunk boundaries and CRLF events", async () => {
  const stream = streamFromChunks([
    "data: {\"choices\":[{\"delta\":{\"content\":\"你",
    "好\"}}]}\r\n\r\n",
    "data: [DONE]\r\n\r\n"
  ]);

  const events = [];
  for await (const data of readSseData(stream)) events.push(data);

  assert.deepEqual(events, [
    "{\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}",
    "[DONE]"
  ]);
});

test("readSseData joins multi-line data fields", async () => {
  const stream = streamFromChunks(["data: first\ndata: second\n\n"]);
  const events = [];
  for await (const data of readSseData(stream)) events.push(data);
  assert.deepEqual(events, ["first\nsecond"]);
});

test("fetchModels authenticates, filters, deduplicates and sorts model ids", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/models");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer sk-test");
    return new Response(JSON.stringify({
      data: [
        { id: "deepseek-reasoner" },
        { id: " deepseek-chat " },
        { id: "deepseek-chat" },
        { id: "" },
        { name: "missing-id" },
        null
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const models = await fetchModels("sk-test", new AbortController().signal);
  assert.deepEqual(models, ["deepseek-chat", "deepseek-reasoner"]);
});

test("fetchModels rejects empty and malformed model responses", async (context) => {
  await context.test("empty list", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    await assert.rejects(fetchModels("sk-test"), (error) => error.code === "empty-models");
  });

  await context.test("invalid shape", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), { status: 200 });
    await assert.rejects(fetchModels("sk-test"), (error) => error.code === "parse");
  });

  await context.test("invalid json", async () => {
    globalThis.fetch = async () => new Response("not json", { status: 200 });
    await assert.rejects(fetchModels("sk-test"), (error) => error.code === "parse");
  });
});

test("fetchModels maps API and network errors without exposing credentials", async (context) => {
  for (const [status, expected] of [[401, /API Key/], [429, /频繁/], [503, /暂时不可用/]]) {
    await context.test(`HTTP ${status}`, async () => {
      globalThis.fetch = async () => new Response("", { status });
      await assert.rejects(fetchModels("sk-secret"), (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /sk-secret/);
        return true;
      });
    });
  }

  await context.test("network failure", async () => {
    globalThis.fetch = async () => { throw new TypeError("offline"); };
    await assert.rejects(fetchModels("sk-secret"), (error) => error.code === "network");
  });
});

test("fetchModels preserves AbortError so callers can distinguish cancel and timeout", async () => {
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
  const controller = new AbortController();
  const request = fetchModels("sk-test", controller.signal);
  controller.abort();
  await assert.rejects(request, (error) => error.name === "AbortError");
});

test("streamChat sends the selected model and streams content", async () => {
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "deepseek-reasoner");
    return new Response(streamFromChunks([
      "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n",
      "data: [DONE]\n\n"
    ]), { status: 200 });
  };

  let answer = "";
  await streamChat({
    apiKey: "sk-test",
    model: "deepseek-reasoner",
    messages: [{ role: "user", content: "question" }],
    onDelta(delta) { answer += delta; }
  });
  assert.equal(answer, "answer");
});

test("streamChat rejects requests without a selected model", async () => {
  await assert.rejects(
    streamChat({ apiKey: "sk-test", model: "", messages: [], onDelta() {} }),
    (error) => error instanceof DeepSeekError && error.code === "configuration"
  );
});

test("describeApiError maps common API statuses", () => {
  assert.match(describeApiError(401), /API Key/);
  assert.match(describeApiError(402), /余额/);
  assert.match(describeApiError(429), /频繁/);
  assert.match(describeApiError(503), /暂时不可用/);
  assert.match(describeApiError(400, "invalid request"), /invalid request/);
});
