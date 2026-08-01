export const BUILTIN_PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    defaultModel: "deepseek-chat",
    supportsModelDiscovery: true
  }),
  "qwen-cn": Object.freeze({
    id: "qwen-cn",
    name: "千问（国内）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    defaultModel: "qwen-plus",
    supportsModelDiscovery: true
  }),
  "qwen-intl": Object.freeze({
    id: "qwen-intl",
    name: "千问（国际）",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    defaultModel: "qwen-plus",
    supportsModelDiscovery: true
  }),
  volcengine: Object.freeze({
    id: "volcengine",
    name: "火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    defaultModel: "",
    supportsModelDiscovery: true
  })
});

export const BUILTIN_PROVIDER_IDS = Object.freeze(Object.keys(BUILTIN_PROVIDERS));

export function isCustomProviderId(providerId) {
  return typeof providerId === "string" && providerId.startsWith("custom:");
}

export function normalizeApiPath(path, fallback) {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value) return fallback;
  return value.startsWith("/") ? value : `/${value}`;
}

export function normalizeBaseUrl(baseUrl) {
  return typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : "";
}

export function validateCustomBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(normalizeBaseUrl(baseUrl));
  } catch {
    return { valid: false, message: "Base URL 格式不正确。" };
  }

  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    return { valid: false, message: "远程自定义接口必须使用 HTTPS；HTTP 仅允许本机地址。" };
  }

  return { valid: true, url };
}

export function getOriginPattern(baseUrl) {
  const validation = validateCustomBaseUrl(baseUrl);
  if (!validation.valid) return "";
  return `${validation.url.protocol}//${validation.url.hostname}/*`;
}

export function resolveProvider(providerId, providerConfig = {}) {
  if (BUILTIN_PROVIDERS[providerId]) return BUILTIN_PROVIDERS[providerId];
  if (!isCustomProviderId(providerId)) return null;

  const validation = validateCustomBaseUrl(providerConfig.baseUrl);
  if (!validation.valid) return null;
  return {
    id: providerId,
    name: providerConfig.name?.trim() || "自定义提供商",
    baseUrl: normalizeBaseUrl(providerConfig.baseUrl),
    modelsPath: normalizeApiPath(providerConfig.modelsPath, "/models"),
    chatPath: normalizeApiPath(providerConfig.chatPath, "/chat/completions"),
    defaultModel: "",
    supportsModelDiscovery: providerConfig.supportsModelDiscovery !== false
  };
}

export function buildApiUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${normalizeApiPath(path, "")}`;
}
