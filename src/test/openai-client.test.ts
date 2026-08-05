import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, describeApiError, fetchModels, readSseData, streamChat } from "../shared/openai-client";
import { BUILTIN_PROVIDERS } from "../shared/providers";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
}

it("parses SSE chunk boundaries, CRLF, and multi-line events", async () => {
  const events: string[] = [];
  for await (const data of readSseData(streamFromChunks(["data: first\r\n", "data: second\r\n\r\n", "data: [DONE]\n\n"]))) events.push(data);
  expect(events).toEqual(["first\nsecond", "[DONE]"]);
});

it("authenticates and normalizes model IDs", async () => {
  globalThis.fetch = vi.fn(async (_url, options) => {
    expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    return new Response(JSON.stringify({ data: [{ id: "qwen-plus" }, { id: " qwen-max " }, { id: "qwen-plus" }] }), { status: 200 });
  });
  await expect(fetchModels({ provider: BUILTIN_PROVIDERS["qwen-cn"], apiKey: "sk-test", signal: new AbortController().signal })).resolves.toEqual(["qwen-max", "qwen-plus"]);
});

describe("model discovery errors", () => {
  it.each([
    [JSON.stringify({ data: [] }), "empty-models"],
    [JSON.stringify({ models: [] }), "parse"],
    ["not json", "parse"]
  ])("rejects invalid payload %s", async (body, code) => {
    globalThis.fetch = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(fetchModels({ provider: BUILTIN_PROVIDERS.deepseek, apiKey: "key", signal: new AbortController().signal })).rejects.toMatchObject({ code });
  });

  it.each([[401, /API Key/], [429, /频繁/], [503, /暂时不可用/]])("maps HTTP %i safely", async (status, expected) => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: status as number }));
    await expect(fetchModels({ provider: BUILTIN_PROVIDERS.volcengine, apiKey: "sk-secret", signal: new AbortController().signal })).rejects.toThrow(expected as RegExp);
  });

  it("maps network failures without leaking credentials", async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError("offline sk-secret"); });
    const error = await fetchModels({ provider: BUILTIN_PROVIDERS.deepseek, apiKey: "sk-secret", signal: new AbortController().signal }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "network" });
    expect((error as Error).message).not.toMatch(/sk-secret/);
  });
});

it("streams assistant deltas and sends the selected model", async () => {
  globalThis.fetch = vi.fn(async (_url, options) => {
    expect(JSON.parse(options?.body as string).model).toBe("qwen-plus");
    return new Response(streamFromChunks(["data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n", "data: [DONE]\n\n"]), { status: 200 });
  });
  let answer = "";
  await streamChat({ provider: BUILTIN_PROVIDERS["qwen-intl"], apiKey: "key", model: "qwen-plus", messages: [{ role: "user", content: "question" }], signal: new AbortController().signal, onDelta: (delta) => { answer += delta; } });
  expect(answer).toBe("answer");
});

it("rejects a missing model before networking", async () => {
  await expect(streamChat({ provider: BUILTIN_PROVIDERS.deepseek, apiKey: "key", model: "", messages: [], signal: new AbortController().signal, onDelta: () => undefined })).rejects.toMatchObject({ code: "configuration" });
  expect(describeApiError("千问", 402)).toMatch(/余额/);
  expect(new ProviderError("x")).toBeInstanceOf(Error);
});
