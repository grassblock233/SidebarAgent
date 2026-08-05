import { buildApiUrl } from "./providers";
import type { ChatMessage, ProviderDescriptor } from "./types";

export class ProviderError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "unknown";
  }
}

export function describeApiError(providerName: string, status: number, apiMessage = ""): string {
  if (status === 401 || status === 403) return `${providerName} API Key 无效或无权访问该资源。`;
  if (status === 402) return `${providerName} 账户余额不足或计费状态异常。`;
  if (status === 429) return `${providerName} 请求过于频繁，请稍后再试。`;
  if (status >= 500) return `${providerName} 服务暂时不可用，请稍后再试。`;
  return apiMessage ? `${providerName} 请求失败：${apiMessage}` : `${providerName} 请求失败（HTTP ${status}）。`;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: { message?: string }; message?: string };
    return data.error?.message || data.message || "";
  } catch {
    return "";
  }
}

export async function* readSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData: string[] = [];
  const flushEvent = (): string | null => {
    if (!eventData.length) return null;
    const data = eventData.join("\n");
    eventData = [];
    return data;
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        const data = flushEvent();
        if (data !== null) yield data;
      } else if (line.startsWith("data:")) eventData.push(line.slice(5).trimStart());
      newlineIndex = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart());
  const finalData = flushEvent();
  if (finalData !== null) yield finalData;
}

interface RequestBase { provider: ProviderDescriptor; apiKey: string; signal: AbortSignal }

export async function fetchModels({ provider, apiKey, signal }: RequestBase): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(buildApiUrl(provider.baseUrl, provider.modelsPath), { method: "GET", headers: { Authorization: `Bearer ${apiKey}` }, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProviderError(`无法连接${provider.name}，请检查网络和接口地址。`, { code: "network" });
  }
  if (!response.ok) throw new ProviderError(describeApiError(provider.name, response.status, await readError(response)), { status: response.status, code: "api" });
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ProviderError(`${provider.name}返回了无法识别的模型列表。`, { code: "parse" }); }
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(data)) throw new ProviderError(`${provider.name}返回的模型列表格式不正确。`, { code: "parse" });
  const models = [...new Set(data.map((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" ? (item as { id: string }).id.trim() : "").filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!models.length) throw new ProviderError(`${provider.name}没有返回可用模型，可以改用手动模型 ID。`, { code: "empty-models" });
  return models;
}

export async function streamChat(options: RequestBase & { model: string; messages: ChatMessage[]; onDelta: (delta: string) => void }): Promise<void> {
  const { provider, apiKey, model, messages, signal, onDelta } = options;
  if (!model) throw new ProviderError(`尚未选择${provider.name}模型。`, { code: "configuration" });
  let response: Response;
  try {
    response = await fetch(buildApiUrl(provider.baseUrl, provider.chatPath), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.3, max_tokens: 2048 }),
      signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ProviderError(`无法连接${provider.name}，请检查网络和接口地址。`, { code: "network" });
  }
  if (!response.ok) throw new ProviderError(describeApiError(provider.name, response.status, await readError(response)), { status: response.status, code: "api" });
  if (!response.body) throw new ProviderError(`${provider.name}返回了空响应。`, { code: "empty" });
  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") break;
    try {
      const event = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    } catch {
      throw new ProviderError(`无法解析${provider.name}返回的数据。`, { code: "parse" });
    }
  }
}
