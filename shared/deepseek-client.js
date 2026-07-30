import { API_URL, MODELS_API_URL } from "./constants.js";

export class DeepSeekError extends Error {
  constructor(message, { status = 0, code = "unknown" } = {}) {
    super(message);
    this.name = "DeepSeekError";
    this.status = status;
    this.code = code;
  }
}

export function describeApiError(status, apiMessage = "") {
  if (status === 401) return "API Key 无效，请在设置中检查后重试。";
  if (status === 402) return "DeepSeek 账户余额不足或计费状态异常。";
  if (status === 429) return "请求过于频繁，请稍后再试。";
  if (status >= 500) return "DeepSeek 服务暂时不可用，请稍后再试。";
  if (apiMessage) return `DeepSeek 请求失败：${apiMessage}`;
  return `DeepSeek 请求失败（HTTP ${status}）。`;
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
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventData = [];

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

export async function fetchModels(apiKey, signal) {
  let response;
  try {
    response = await fetch(MODELS_API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new DeepSeekError("无法连接 DeepSeek，请检查网络后重试。", { code: "network" });
  }

  if (!response.ok) {
    const apiMessage = await readError(response);
    throw new DeepSeekError(describeApiError(response.status, apiMessage), {
      status: response.status,
      code: "api"
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new DeepSeekError("DeepSeek 返回了无法识别的模型列表。", { code: "parse" });
  }

  if (!Array.isArray(payload?.data)) {
    throw new DeepSeekError("DeepSeek 返回的模型列表格式不正确。", { code: "parse" });
  }

  const models = [...new Set(
    payload.data
      .map((item) => typeof item?.id === "string" ? item.id.trim() : "")
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right, "en"));

  if (!models.length) {
    throw new DeepSeekError("DeepSeek 没有返回可用模型。", { code: "empty-models" });
  }

  return models;
}

export async function streamChat({ apiKey, model, messages, signal, onDelta }) {
  if (!model) {
    throw new DeepSeekError("尚未选择 DeepSeek 模型。", { code: "configuration" });
  }

  let response;
  try {
    response = await fetch(API_URL, {
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
    throw new DeepSeekError("无法连接 DeepSeek，请检查网络后重试。", { code: "network" });
  }

  if (!response.ok) {
    const apiMessage = await readError(response);
    throw new DeepSeekError(describeApiError(response.status, apiMessage), {
      status: response.status,
      code: "api"
    });
  }

  if (!response.body) {
    throw new DeepSeekError("DeepSeek 返回了空响应。", { code: "empty" });
  }

  for await (const data of readSseData(response.body)) {
    if (data === "[DONE]") break;
    try {
      const event = JSON.parse(data);
      const delta = event?.choices?.[0]?.delta?.content;
      if (delta) onDelta(delta);
    } catch {
      throw new DeepSeekError("无法解析 DeepSeek 返回的数据。", { code: "parse" });
    }
  }
}
