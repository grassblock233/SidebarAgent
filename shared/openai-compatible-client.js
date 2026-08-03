// Network client for OpenAI-compatible model discovery and streaming chat.
// Callers own timeouts through AbortSignal; this module never logs credentials.
import { buildApiUrl } from "./providers.js";

export class ProviderError extends Error {
  constructor(message, { status = 0, code = "unknown" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

export function describeApiError(providerName, status, apiMessage = "") {
  if (status === 401 || status === 403) return `${providerName} API Key 无效或无权访问该资源。`;
  if (status === 402) return `${providerName} 账户余额不足或计费状态异常。`;
  if (status === 429) return `${providerName} 请求过于频繁，请稍后再试。`;
  if (status >= 500) return `${providerName} 服务暂时不可用，请稍后再试。`;
  if (apiMessage) return `${providerName} 请求失败：${apiMessage}`;
  return `${providerName} 请求失败（HTTP ${status}）。`;
}

async function readError(response) {
  try {
    const data = await response.json();
    return data?.error?.message || data?.message || "";
  } catch {
    return "";
  }
}

export async function* readSseData(stream) {
  // SSE frames can be split across arbitrary network chunks, including CRLF.
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData = [];

  // Multiple data lines belong to one event and are joined per the SSE format.
  const flushEvent = () => {
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
      } else if (line.startsWith("data:")) {
        eventData.push(line.slice(5).trimStart());
      }
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (buffer.startsWith("data:")) eventData.push(buffer.slice(5).trimStart());
  const finalData = flushEvent();
  if (finalData !== null) yield finalData;
}

export async function fetchModels({ provider, apiKey, signal }) {
  let response;
  try {
    response = await fetch(buildApiUrl(provider.baseUrl, provider.modelsPath), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ProviderError(`无法连接${provider.name}，请检查网络和接口地址。`, { code: "network" });
  }

  if (!response.ok) {
    const apiMessage = await readError(response);
    throw new ProviderError(describeApiError(provider.name, response.status, apiMessage), {
      status: response.status,
      code: "api"
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderError(`${provider.name}返回了无法识别的模型列表。`, { code: "parse" });
  }

  if (!Array.isArray(payload?.data)) {
    throw new ProviderError(`${provider.name}返回的模型列表格式不正确。`, { code: "parse" });
  }

  // Providers may return duplicates or metadata-only entries; expose stable IDs only.
  const models = [...new Set(
    payload.data
      .map((item) => typeof item?.id === "string" ? item.id.trim() : "")
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en"));

  if (!models.length) {
    throw new ProviderError(`${provider.name}没有返回可用模型，可以改用手动模型 ID。`, { code: "empty-models" });
  }
  return models;
}

export async function streamChat({ provider, apiKey, model, messages, signal, onDelta }) {
  if (!model) throw new ProviderError(`尚未选择${provider.name}模型。`, { code: "configuration" });

  let response;
  try {
    response = await fetch(buildApiUrl(provider.baseUrl, provider.chatPath), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 2048
      }),
      signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ProviderError(`无法连接${provider.name}，请检查网络和接口地址。`, { code: "network" });
  }

  if (!response.ok) {
    const apiMessage = await readError(response);
    throw new ProviderError(describeApiError(provider.name, response.status, apiMessage), {
      status: response.status,
      code: "api"
    });
  }
  if (!response.body) throw new ProviderError(`${provider.name}返回了空响应。`, { code: "empty" });

  // Parse one event at a time so the UI can render deltas without buffering the reply.
  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") break;
    try {
      const event = JSON.parse(data);
      const delta = event?.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    } catch {
      throw new ProviderError(`无法解析${provider.name}返回的数据。`, { code: "parse" });
    }
  }
}
